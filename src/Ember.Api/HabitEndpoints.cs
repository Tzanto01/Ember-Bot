using System.Security.Claims;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Habits, their days and the habit templates.</summary>
internal static class HabitEndpoints
{
    public const int MaxDaysPerRequest = 366;

    public sealed record DayDto(DateOnly Date, string State, bool? Completed, int Count);
    public sealed record WeekDto(int Done, int Target);
    public sealed record StatsDto(int? Streak, int? GraceUsed, int? BestStreak, int Last7, WeekDto? Week);

    public sealed record HabitDto(
        int Id, string Name, string Frequency, int? WeeklyTarget, string? ReminderTime,
        DateOnly? PausedFrom, DateOnly? PausedUntil, bool PausedToday, DateTime CreatedAt, DateOnly StartDate,
        DayDto Today, StatsDto Stats, List<string> ReminderChannels, List<string>? Days, int TimesPerDay, int? RoutineId,
        List<string> ReminderTimes, List<string> ReminderExclusions, bool ServerReminders);

    public sealed record TemplateDto(string Key, string Name, string Description, string SuggestedReminderTime, string Frequency, int? WeeklyTarget);

    public sealed record CreateHabitRequest(string? Name, string? ReminderTime, string? Frequency, int? WeeklyTarget,
        string?[]? Days, int? TimesPerDay, string?[]? ReminderTimes, string?[]? ReminderExclusions);
    public sealed record UpdateHabitRequest(string? Name, string? ReminderTime, bool? ClearReminder, string? Frequency, int? WeeklyTarget,
        string?[]? ReminderExclusions, string?[]? Days, int? TimesPerDay, string?[]? ReminderTimes);
    public sealed record PauseRequest(string? Until);
    public sealed record DayRequest(bool? Completed, int? Count);

    private sealed record UserDays(TimeZoneInfo Tz, DateOnly Today, int GraceDays, IReadOnlySet<DateOnly> LowDays, User Destinations,
        HashSet<string> DestinationIds);

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
            var reminder = request.ReminderTimes is null ? ParseReminder(request.ReminderTime, errors) : null;
            var frequency = ParseFrequency(request.Frequency);
            if (frequency is null) errors["frequency"] = [FrequencyMessage];
            ValidateWeeklyTarget(request.WeeklyTarget, frequency, errors);
            var days = ValidateDays(request.Days, frequency, null, errors);
            var timesPerDay = ValidateTimesPerDay(request.TimesPerDay ?? 1, frequency, errors);
            var reminderTimes = ParseReminderTimes(request.ReminderTimes, timesPerDay, errors);
            var userId = principal.UserId();
            var exclusions = await ParseReminderExclusionsAsync(request.ReminderExclusions, habits, userId, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            Habit habit;
            try
            {
                habit = await habits.AddHabitAsync(userId, name!, reminder, frequency!.Value, request.WeeklyTarget,
                    exclusions, days, timesPerDay, reminderTimes);
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
            var reminder = request.ReminderTimes is null ? ParseReminder(request.ReminderTime, errors) : null;
            if (request.ReminderTime is not null && request.ClearReminder == true)
                errors["reminderTime"] = ["Can't be combined with clearReminder."];
            if (request.ReminderTimes is not null && request.ClearReminder == true)
                errors["reminderTimes"] = ["Can't be combined with clearReminder."];
            var frequency = ParseFrequency(request.Frequency);
            if (request.Frequency is not null && frequency is null) errors["frequency"] = [FrequencyMessage];
            var newFrequency = request.Frequency is null ? habit.FrequencyType : frequency;
            ValidateWeeklyTarget(request.WeeklyTarget, frequency ?? habit.FrequencyType, errors);
            var days = ValidateDays(request.Days, newFrequency, habit.Days, errors);
            var timesPerDay = ValidateTimesPerDay(
                request.TimesPerDay ?? (newFrequency == FrequencyType.Weekly ? 1 : habit.TimesPerDay), newFrequency, errors);
            var reminderTimes = ParseReminderTimes(request.ReminderTimes, timesPerDay, errors);
            var exclusions = await ParseReminderExclusionsAsync(request.ReminderExclusions, habits, userId, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            if (frequency is not null || request.WeeklyTarget is not null || request.Days is not null || request.TimesPerDay is not null)
                await habits.SetScheduleAsync(userId, id, newFrequency!.Value, request.WeeklyTarget ?? habit.WeeklyTarget, days, timesPerDay);
            if (name is not null || reminder is not null || reminderTimes is not null || request.ClearReminder == true || exclusions is not null)
                await habits.EditHabitAsync(userId, id, name, reminder, request.ClearReminder == true, exclusions, reminderTimes);

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
            if (request.Completed is null && request.Count is null) errors["completed"] = ["Send completed or count."];
            if (request.Completed is not null && request.Count is not null) errors["count"] = ["Can't be combined with completed."];
            if (errors.Count > 0) return Problems.Validation(errors);

            var userId = principal.UserId();
            if (request.Count is not { } count)
                return Problems.DayEdit(await habits.CheckInAsync(userId, id, day, request.Completed!.Value))
                    ?? await HabitResult(habits, userId, id);

            if (await habits.GetHabitAsync(userId, id) is not { } habit) return Problems.NotFound();
            if (count < 0) return Problems.Validation("count", "Can't be negative.");
            return Problems.DayEdit(await habits.SetCountAsync(userId, id, day, Math.Min(count, habit.TimesPerDay)))
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

    internal const string FrequencyMessage = "Must be daily, weekly or weekdays.";

    private static async Task<IResult> HabitResult(HabitService habits, Guid userId, int id)
        => await habits.GetHabitAsync(userId, id) is { } habit
            ? Results.Ok(ToDto(habit, await LoadUserDays(habits, userId)))
            : Problems.NotFound();

    private static async Task<UserDays> LoadUserDays(HabitService habits, Guid userId)
    {
        var destinations = await habits.GetUserWithDestinationsAsync(userId) ?? new User { Id = userId };
        return new(await habits.GetUserTzAsync(userId), await habits.GetLocalTodayAsync(userId),
            await habits.GetGraceDaysAsync(userId), await habits.GetLowDaysAsync(userId), destinations, ReminderDestinations.Ids(destinations));
    }

    private static HabitDto ToDto(Habit habit, UserDays user)
    {
        var s = HabitService.StatsOn(habit, user.Today, user.GraceDays, user.LowDays, user.Tz);
        var stats = new StatsDto(s.Streak, s.GraceUsed, s.BestStreak, s.Last7, s.Week is { } week ? new WeekDto(week.Done, week.Target) : null);
        var targets = ReminderDestinations.Resolve(user.Destinations, habit.ReminderExclusions);

        return new HabitDto(
            habit.Id, habit.Name, Lower(habit.FrequencyType), habit.WeeklyTarget,
            habit.ReminderTime is { } time ? Formats.Time(time) : null,
            habit.PausedFrom, habit.PausedUntil, HabitService.IsPausedOn(habit, user.Today),
            DateTime.SpecifyKind(habit.CreatedAt, DateTimeKind.Utc), HabitService.StartDate(habit, user.Tz),
            ToDayDto(HabitService.DayOn(habit, user.Today, user.Today, user.Tz, user.LowDays)), stats,
            ReminderDestinations.LegacyChannels(targets),
            habit.FrequencyType == FrequencyType.Weekdays && habit.Days is { } days ? ScheduleDayNames.ToNames(days) : null,
            habit.TimesPerDay, habit.RoutineId, habit.ReminderTimes.Select(Formats.Time).ToList(),
            habit.ReminderExclusions.Where(user.DestinationIds.Contains).ToList(), targets.Any);
    }

    private static DayDto ToDayDto(HabitDay day) => new(day.Date, Lower(day.State), day.Completed, day.Count);

    private static string Lower<T>(T value) where T : struct, Enum => value.ToString().ToLowerInvariant();

    internal static string? ValidName(string? name, Dictionary<string, string[]> errors, int maxLength = 100)
    {
        var trimmed = name?.Trim();
        if (trimmed is { Length: >= 1 } && trimmed.Length <= maxLength) return trimmed;
        errors["name"] = [$"Must be 1 to {maxLength} characters."];
        return null;
    }

    internal static TimeOnly? ParseReminder(string? value, Dictionary<string, string[]> errors)
    {
        if (value is null) return null;
        if (Formats.TryParseTime(value, out var time)) return time;
        errors["reminderTime"] = ["Must be a time as HH:mm."];
        return null;
    }

    /// <summary>
    /// The reminder times in <paramref name="values"/> sorted ascending, or null when <paramref name="values"/> is null or invalid:
    /// each must be HH:mm, without repeats, and at most <paramref name="timesPerDay"/> of them. Empty clears the reminder.
    /// </summary>
    internal static List<TimeOnly>? ParseReminderTimes(string?[]? values, int timesPerDay, Dictionary<string, string[]> errors)
    {
        if (values is null) return null;
        var times = new List<TimeOnly>();
        foreach (var value in values)
        {
            if (value is null || !Formats.TryParseTime(value, out var time))
            {
                errors["reminderTimes"] = ["Each must be a time as HH:mm."];
                return null;
            }
            times.Add(time);
        }

        var max = Math.Min(timesPerDay, HabitService.MaxTimesPerDay);
        if (times.Distinct().Count() != times.Count) errors["reminderTimes"] = ["Each time can appear only once."];
        else if (times.Count > max) errors["reminderTimes"] = [$"At most {max}, the habit's timesPerDay."];
        else return times.Order().ToList();
        return null;
    }

    /// <summary>
    /// The distinct <paramref name="values"/>, or null when <paramref name="values"/> is null or invalid: each must be the id of one of
    /// the user's current reminder destinations.
    /// </summary>
    internal static async Task<List<string>?> ParseReminderExclusionsAsync(string?[]? values, HabitService habits, Guid userId,
        Dictionary<string, string[]> errors)
    {
        if (values is null) return null;
        var ids = await habits.GetUserWithDestinationsAsync(userId) is { } user ? ReminderDestinations.Ids(user) : [];
        if (values.All(v => v is not null && ids.Contains(v))) return values.Select(v => v!).Distinct().ToList();
        errors["reminderExclusions"] = ["Each must be the id of one of your reminder destinations."];
        return null;
    }

    internal static FrequencyType? ParseFrequency(string? value) => value switch
    {
        "daily" => FrequencyType.Daily,
        "weekly" => FrequencyType.Weekly,
        "weekdays" => FrequencyType.Weekdays,
        _ => null,
    };

    /// <summary>
    /// The days for <paramref name="frequency"/>: the parsed <paramref name="values"/> (1–6 distinct names, weekdays habits only),
    /// else <paramref name="current"/> for a weekdays habit. Null for daily and weekly habits.
    /// </summary>
    internal static ScheduleDays? ValidateDays(string?[]? values, FrequencyType? frequency, ScheduleDays? current,
        Dictionary<string, string[]> errors)
    {
        if (frequency is null) return null;
        if (values is null)
        {
            if (frequency != FrequencyType.Weekdays) return null;
            if (current is not null and not ScheduleDays.None) return current;
            errors["days"] = ["Required for weekdays habits."];
            return null;
        }

        if (frequency != FrequencyType.Weekdays) errors["days"] = ["Only for weekdays habits."];
        else if (!ScheduleDayNames.TryParse(values, out var days)) errors["days"] = ["Each must be one of mon, tue, wed, thu, fri, sat, sun, without repeats."];
        else if (values.Length == 7) errors["days"] = ["All seven days: use daily instead."];
        else if (values.Length == 0) errors["days"] = ["Pick 1 to 6 days."];
        else return days;
        return null;
    }

    internal static int ValidateTimesPerDay(int timesPerDay, FrequencyType? frequency, Dictionary<string, string[]> errors)
    {
        if (frequency == FrequencyType.Weekly && timesPerDay != 1) errors["timesPerDay"] = ["Always 1 for weekly habits."];
        else if (timesPerDay is < 1 or > HabitService.MaxTimesPerDay) errors["timesPerDay"] = [$"Must be between 1 and {HabitService.MaxTimesPerDay}."];
        return timesPerDay;
    }

    internal static void ValidateWeeklyTarget(int? weeklyTarget, FrequencyType? frequency, Dictionary<string, string[]> errors)
    {
        if (weeklyTarget is null) return;
        if (frequency != FrequencyType.Weekly) errors["weeklyTarget"] = ["Only for weekly habits."];
        else if (weeklyTarget is < 1 or > 6) errors["weeklyTarget"] = ["Must be between 1 and 6."];
    }
}
