using System.Security.Claims;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Habits, their days and the habit templates.</summary>
internal static class HabitEndpoints
{
    public const int MaxDaysPerRequest = 366;

    public sealed record DayDto(DateOnly Date, string State, bool? Completed);
    public sealed record WeekDto(int Done, int Target);
    public sealed record StatsDto(int? Streak, int? GraceUsed, int? BestStreak, int Last7, WeekDto? Week);

    public sealed record HabitDto(
        int Id, string Name, string Frequency, int? WeeklyTarget, string? ReminderTime,
        DateOnly? PausedFrom, DateOnly? PausedUntil, bool PausedToday, DateTime CreatedAt, DateOnly StartDate,
        DayDto Today, StatsDto Stats, List<string> ReminderChannels);

    public sealed record TemplateDto(string Key, string Name, string Description, string SuggestedReminderTime, string Frequency, int? WeeklyTarget);

    public sealed record CreateHabitRequest(string? Name, string? ReminderTime, string? Frequency, int? WeeklyTarget);
    public sealed record UpdateHabitRequest(string? Name, string? ReminderTime, bool? ClearReminder, string? Frequency, int? WeeklyTarget,
        string?[]? ReminderChannels);
    public sealed record PauseRequest(string? Until);
    public sealed record DayRequest(bool? Completed);

    private sealed record UserDays(TimeZoneInfo Tz, DateOnly Today, int GraceDays, IReadOnlySet<DateOnly> LowDays);

    public static RouteGroupBuilder MapHabits(this RouteGroupBuilder api)
    {
        api.MapGet("/habits", async (ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            var list = await habits.GetHabitsAsync(userId);
            var days = await LoadUserDays(habits, userId);
            return list.Select(h => ToDto(h, days)).ToList();
        });

        api.MapGet("/habits/{id:int}", async (int id, ClaimsPrincipal principal, HabitService habits) =>
            await HabitResult(habits, principal.UserId(), id));

        api.MapPost("/habits", async (CreateHabitRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            var name = ValidName(request.Name, errors);
            var reminder = ParseReminder(request.ReminderTime, errors);
            var frequency = ParseFrequency(request.Frequency);
            if (frequency is null) errors["frequency"] = [FrequencyMessage];
            ValidateWeeklyTarget(request.WeeklyTarget, frequency, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var userId = principal.UserId();
            Habit habit;
            try
            {
                habit = await habits.AddHabitAsync(userId, name!, reminder, frequency!.Value, request.WeeklyTarget, ReminderChannels.WebPush);
            }
            catch (ConsentRequiredException)
            {
                return Problems.ConsentRequired();
            }
            catch (HabitLimitReachedException)
            {
                return Problems.HabitLimit();
            }

            return Results.Created($"/api/habits/{habit.Id}", ToDto(habit, await LoadUserDays(habits, userId)));
        });

        api.MapPatch("/habits/{id:int}", async (int id, UpdateHabitRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            var habit = await habits.GetHabitAsync(userId, id);
            if (habit is null) return Problems.NotFound();

            var errors = new Dictionary<string, string[]>();
            var name = request.Name is null ? null : ValidName(request.Name, errors);
            var reminder = ParseReminder(request.ReminderTime, errors);
            if (request.ReminderTime is not null && request.ClearReminder == true)
                errors["reminderTime"] = ["Can't be combined with clearReminder."];
            var frequency = ParseFrequency(request.Frequency);
            if (request.Frequency is not null && frequency is null) errors["frequency"] = [FrequencyMessage];
            ValidateWeeklyTarget(request.WeeklyTarget, frequency ?? habit.FrequencyType, errors);
            var channels = ParseReminderChannels(request.ReminderChannels, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            if (name is not null || reminder is not null || request.ClearReminder == true || channels is not null)
                await habits.EditHabitAsync(userId, id, name, reminder, request.ClearReminder == true, channels);
            if (frequency is not null || request.WeeklyTarget is not null)
                await habits.SetFrequencyAsync(userId, id, frequency ?? habit.FrequencyType, request.WeeklyTarget ?? habit.WeeklyTarget);

            return await HabitResult(habits, userId, id);
        });

        api.MapDelete("/habits/{id:int}", async (int id, ClaimsPrincipal principal, HabitService habits) =>
            await habits.DeleteHabitAsync(principal.UserId(), id) ? Results.NoContent() : Problems.NotFound());

        api.MapPost("/habits/{id:int}/pause", async (int id, PauseRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            DateOnly? until = null;
            if (request.Until is not null)
            {
                if (!Formats.TryParseDate(request.Until, out var date)) return Problems.Validation("until", Formats.DateMessage);
                if (date < await habits.GetLocalTodayAsync(userId)) return Problems.Validation("until", "Can't be before today.");
                until = date;
            }

            return await habits.PauseHabitAsync(userId, id, until) is null
                ? Problems.NotFound()
                : await HabitResult(habits, userId, id);
        });

        api.MapGet("/habits/{id:int}/days", async (int id, string? from, string? to, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            var today = await habits.GetLocalTodayAsync(userId);
            var errors = new Dictionary<string, string[]>();
            var end = Formats.DateOr(to, today, "to", errors);
            var start = Formats.DateOr(from, Formats.DaysBefore(end, 13), "from", errors);
            if (errors.Count == 0)
            {
                if (end > today) errors["to"] = ["Can't be after today."];
                else if (start > end) errors["from"] = ["Can't be after to."];
                else if (end.DayNumber - start.DayNumber + 1 > MaxDaysPerRequest) errors["from"] = [$"At most {MaxDaysPerRequest} days per request."];
            }
            if (errors.Count > 0) return Problems.Validation(errors);

            var days = await habits.GetHabitDaysAsync(userId, id, start, end);
            return days is null ? Problems.NotFound() : Results.Ok(days.Select(ToDayDto).ToList());
        });

        api.MapPut("/habits/{id:int}/days/{date}", async (int id, string date, DayRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (!Formats.TryParseDate(date, out var day)) errors["date"] = [Formats.DateMessage];
            if (request.Completed is null) errors["completed"] = ["Required."];
            if (errors.Count > 0) return Problems.Validation(errors);

            var userId = principal.UserId();
            return Problems.DayEdit(await habits.CheckInAsync(userId, id, day, request.Completed ?? false))
                ?? await HabitResult(habits, userId, id);
        });

        api.MapDelete("/habits/{id:int}/days/{date}", async (int id, string date, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (!Formats.TryParseDate(date, out var day)) return Problems.Validation("date", Formats.DateMessage);

            var userId = principal.UserId();
            return Problems.DayEdit(await habits.ClearDayAsync(userId, id, day))
                ?? await HabitResult(habits, userId, id);
        });

        return api;
    }

    public static RouteGroupBuilder MapHabitTemplates(this RouteGroupBuilder api)
    {
        api.MapGet("/habit-templates", () => HabitTemplates.All
            .Select(t => new TemplateDto(t.Key, t.DisplayName, t.Description, Formats.Time(t.SuggestedReminderTime),
                t.Frequency.ToString().ToLowerInvariant(),
                t.Frequency == HabitTemplates.FrequencyHint.Weekly ? t.WeeklyTarget : null))
            .ToList());
        return api;
    }

    private const string FrequencyMessage = "Must be daily or weekly.";

    private static async Task<IResult> HabitResult(HabitService habits, Guid userId, int id)
        => await habits.GetHabitAsync(userId, id) is { } habit
            ? Results.Ok(ToDto(habit, await LoadUserDays(habits, userId)))
            : Problems.NotFound();

    private static async Task<UserDays> LoadUserDays(HabitService habits, Guid userId)
        => new(await habits.GetUserTzAsync(userId), await habits.GetLocalTodayAsync(userId),
            await habits.GetGraceDaysAsync(userId), await habits.GetLowDaysAsync(userId));

    private static HabitDto ToDto(Habit habit, UserDays user)
    {
        var last7 = HabitService.FlexibleStreak(habit, user.Today, 7, user.LowDays, user.Tz);
        StatsDto stats;
        if (habit.FrequencyType == FrequencyType.Weekly)
        {
            var (done, target) = HabitService.WeeklyProgress(habit, user.Today);
            stats = new StatsDto(null, null, null, last7, new WeekDto(done, target));
        }
        else
        {
            var (streak, graceUsed) = HabitService.ConsecutiveStreak(habit, user.Today, user.GraceDays, user.LowDays);
            stats = new StatsDto(streak, graceUsed, HabitService.BestStreak(habit, user.Today, user.GraceDays, user.LowDays), last7, null);
        }

        return new HabitDto(
            habit.Id, habit.Name, Lower(habit.FrequencyType), habit.WeeklyTarget,
            habit.ReminderTime is { } time ? Formats.Time(time) : null,
            habit.PausedFrom, habit.PausedUntil, HabitService.IsPausedOn(habit, user.Today),
            DateTime.SpecifyKind(habit.CreatedAt, DateTimeKind.Utc), HabitService.StartDate(habit, user.Tz),
            ToDayDto(HabitService.DayOn(habit, user.Today, user.Today, user.Tz, user.LowDays)), stats,
            HabitService.ReminderChannelNames(habit.ReminderChannels));
    }

    private static DayDto ToDayDto(HabitDay day) => new(day.Date, Lower(day.State), day.Completed);

    private static string Lower<T>(T value) where T : struct, Enum => value.ToString().ToLowerInvariant();

    private static string? ValidName(string? name, Dictionary<string, string[]> errors)
    {
        var trimmed = name?.Trim();
        if (trimmed is { Length: >= 1 and <= 100 }) return trimmed;
        errors["name"] = ["Must be 1 to 100 characters."];
        return null;
    }

    private static TimeOnly? ParseReminder(string? value, Dictionary<string, string[]> errors)
    {
        if (value is null) return null;
        if (Formats.TryParseTime(value, out var time)) return time;
        errors["reminderTime"] = ["Must be a time as HH:mm."];
        return null;
    }

    private static ReminderChannels? ParseReminderChannels(string?[]? values, Dictionary<string, string[]> errors)
    {
        if (values is null) return null;
        var channels = ReminderChannels.None;
        foreach (var value in values)
        {
            switch (value)
            {
                case "discord": channels |= ReminderChannels.Discord; break;
                case "webpush": channels |= ReminderChannels.WebPush; break;
                default:
                    errors["reminderChannels"] = ["Each must be discord or webpush."];
                    return null;
            }
        }
        return channels;
    }

    private static FrequencyType? ParseFrequency(string? value) => value switch
    {
        "daily" => FrequencyType.Daily,
        "weekly" => FrequencyType.Weekly,
        _ => null,
    };

    private static void ValidateWeeklyTarget(int? weeklyTarget, FrequencyType? frequency, Dictionary<string, string[]> errors)
    {
        if (weeklyTarget is null) return;
        if (frequency != FrequencyType.Weekly) errors["weeklyTarget"] = ["Only for weekly habits."];
        else if (weeklyTarget is < 1 or > 6) errors["weeklyTarget"] = ["Must be between 1 and 6."];
    }
}
