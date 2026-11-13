using System.Security.Claims;
using System.Text.Json;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Ember.Api;

/// <summary><c>POST /api/me/import</c>: a JSON export (format v2) into an empty account (contract "Export format v2").</summary>
internal static class ImportEndpoints
{
    public const long MaxBodyBytes = 5 * 1024 * 1024;

    public sealed record ImportDocument(int? FormatVersion, ImportSettings? Settings, List<ImportHabit?>? Habits, List<ImportLog?>? Logs,
        List<ImportDayMark?>? DayMarks, List<ImportRoutine?>? Routines, List<ImportMood?>? Moods, List<ImportDayNote?>? DayNotes,
        JournalEndpoints.JournalKeyRequest? JournalKey);
    public sealed record ImportSettings(int? GraceDaysPerWeek, string? Theme, int? SecondReminderMinutes, bool? ShowStreaks);
    public sealed record ImportHabit(int? Id, string? Name, string? Frequency, int? WeeklyTarget, TimeOnly? ReminderTime,
        DateOnly? PausedUntil, DateOnly? PausedFrom, DateTimeOffset? CreatedAt, string?[]? Days,
        int? TimesPerDay, int? RoutineId, int? RoutinePosition, TimeOnly[]? ReminderTimes);
    public sealed record ImportLog(int? HabitId, DateOnly? Date, bool? Completed, int? Count);
    public sealed record ImportDayMark(DateOnly? Date, string? Kind);
    public sealed record ImportRoutine(int? Id, string? Name, TimeOnly? ReminderTime);
    public sealed record ImportMood(int? Id, string? Label, string? Emoji, bool? Archived, JournalEndpoints.EncryptedDto? Encrypted);
    public sealed record ImportDayNote(DateOnly? Date, string? Text, string? Mood, JournalEndpoints.EncryptedDto? Encrypted);

    public static RouteGroupBuilder MapImport(this RouteGroupBuilder api)
    {
        api.MapPost("/me/import", async (JsonElement body, ClaimsPrincipal principal, HabitService habits, TimeProvider time,
            UserManager<User> users, SignInManager<User> signIn) =>
        {
            var userId = principal.UserId();
            if (!await habits.HasHealthDataConsentAsync(userId)) return Problems.ConsentRequired();
            if (!await habits.IsAccountEmptyAsync(userId)) return Problems.Conflict(NotEmptyMessage);

            ImportDocument? doc;
            try
            {
                doc = body.Deserialize<ImportDocument>(ExportBuilder.JsonOptions);
            }
            catch (JsonException e)
            {
                return Problems.Validation(e.Path is { Length: > 2 } path ? path[2..] : "body", "Has the wrong type or format.");
            }
            if (doc is null) return Problems.Validation("body", "Must be a JSON export.");
            if (doc.FormatVersion != ExportBuilder.CurrentFormatVersion)
                return Problems.Validation("format_version", $"Must be {ExportBuilder.CurrentFormatVersion}.");

            if (doc.JournalKey is not null && await users.GetUserAsync(principal) is { } user
                && await JournalEndpoints.PasswordProblem(user, doc.JournalKey.Password, users, signIn) is { } passwordProblem)
                return passwordProblem;

            if (doc.Habits?.Count > HabitService.MaxHabitsPerUser) return Problems.HabitLimit();
            if (doc.Routines?.Count > HabitService.MaxRoutinesPerUser)
                return Problems.Conflict($"The file has more than {HabitService.MaxRoutinesPerUser} routines, the most Ember can hold.");
            if (doc.Moods?.Count(m => m?.Archived != true) > HabitService.MaxActiveMoodsPerUser)
                return Problems.Conflict($"The file has more than {HabitService.MaxActiveMoodsPerUser} active moods, the most Ember can hold.");

            var errors = new Dictionary<string, string[]>();
            var data = Validate(doc, await habits.GetJournalKeyAsync(userId), await habits.GetUserTzAsync(userId),
                await habits.GetLocalTodayAsync(userId), time.GetUtcNow().UtcDateTime, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            return await habits.ImportAsync(userId, data) switch
            {
                ImportResult.Imported => Results.NoContent(),
                ImportResult.JournalKeyExists => Problems.Conflict("This account already has a private journal key."),
                _ => Problems.Conflict(NotEmptyMessage),
            };
        }).WithMetadata(new RequestSizeLimitAttribute(MaxBodyBytes)).RequireRateLimiting(RateLimits.AuthPolicy);
        return api;
    }

    private static ImportData Validate(ImportDocument doc, JournalKey? accountKey, TimeZoneInfo tz, DateOnly today, DateTime now,
        Dictionary<string, string[]> errors)
    {
        var local = new Dictionary<string, string[]>();

        MeEndpoints.ValidateGraceAndTheme(doc.Settings?.GraceDaysPerWeek, doc.Settings?.Theme, local);
        MeEndpoints.ValidateSecondReminder(doc.Settings?.SecondReminderMinutes, local);
        Nest(errors, "settings", local);

        var routines = new List<Routine>();
        var routineById = new Dictionary<int, Routine>();
        foreach (var (r, path) in Items(doc.Routines, "routines", errors))
        {
            var name = HabitEndpoints.ValidName(r.Name, local, RoutineEndpoints.MaxNameLength);
            var routine = new Routine
            {
                Name = name ?? "",
                ReminderTime = r.ReminderTime,
                CreatedAt = now,
            };
            if (r.Id is { } id && !routineById.TryAdd(id, routine)) local["id"] = [UniqueId];
            routines.Add(routine);
            Nest(errors, path, local);
        }

        var habits = new List<Habit>();
        var habitById = new Dictionary<int, Habit>();
        foreach (var (h, path) in Items(doc.Habits, "habits", errors))
        {
            var name = HabitEndpoints.ValidName(h.Name, local);
            var frequency = HabitEndpoints.ParseFrequency(h.Frequency);
            if (frequency is null) local["frequency"] = [HabitEndpoints.FrequencyMessage];
            HabitEndpoints.ValidateWeeklyTarget(h.WeeklyTarget, frequency, local);
            var days = HabitEndpoints.ValidateDays(h.Days, frequency, null, local);
            var timesPerDay = HabitEndpoints.ValidateTimesPerDay(h.TimesPerDay ?? 1, frequency, local);
            if (h.PausedFrom is not null && h.PausedUntil is null) local["paused_from"] = ["Needs paused_until."];
            else if (h.PausedFrom > h.PausedUntil) local["paused_from"] = ["Can't be after paused_until."];
            var createdAt = h.CreatedAt?.UtcDateTime ?? now;
            if (createdAt > now) local["created_at"] = ["Can't be in the future."];
            Routine? routine = null;
            if (h.RoutineId is { } routineId && !routineById.TryGetValue(routineId, out routine))
                local["routine_id"] = ["Must be the id of a routine in this file."];
            if (h.RoutinePosition < 0) local["routine_position"] = ["Can't be negative."];
            var reminderTimes = h.ReminderTimes ?? (h.ReminderTime is { } single ? [single] : []);
            var timesTarget = frequency == FrequencyType.Weekly ? 1 : timesPerDay;
            if (reminderTimes.Distinct().Count() > timesTarget) local["reminder_times"] = [$"At most {timesTarget}, the habit's times_per_day."];

            var habit = new Habit
            {
                Name = name ?? "",
                ReminderTimes = HabitService.NormalizeReminderTimes(reminderTimes, timesTarget),
                PausedFrom = h.PausedFrom,
                PausedUntil = h.PausedUntil,
                FrequencyType = frequency ?? FrequencyType.Daily,
                WeeklyTarget = frequency == FrequencyType.Weekly ? h.WeeklyTarget ?? 3 : null,
                Days = frequency == FrequencyType.Weekdays ? days : null,
                TimesPerDay = frequency == FrequencyType.Weekly ? 1 : timesPerDay,
                Routine = routine,
                RoutinePosition = routine is null ? 0 : h.RoutinePosition ?? 0,
                CreatedAt = createdAt,
            };
            if (h.Id is { } id && !habitById.TryAdd(id, habit)) local["id"] = [UniqueId];
            habits.Add(habit);
            Nest(errors, path, local);
        }
        DateOnly? earliestStart = habits.Count == 0 ? null : habits.Min(h => HabitService.StartDate(h, tz));

        var logged = new HashSet<(Habit, DateOnly)>();
        foreach (var (l, path) in Items(doc.Logs, "logs", errors))
        {
            Habit? habit = null;
            if (l.HabitId is not { } habitId || !habitById.TryGetValue(habitId, out habit))
                local["habit_id"] = ["Must be the id of a habit in this file."];
            if (l.Date is not { } date) local["date"] = [Formats.DateMessage];
            else if (date > today) local["date"] = ["Can't be after today."];
            else if (habit is not null && date < HabitService.StartDate(habit, tz)) local["date"] = ["Can't be before the habit's start."];
            else if (habit is not null && !logged.Add((habit, date))) local["date"] = ["Only one log per habit and day."];
            var count = l.Count ?? -1;
            var target = habit?.TimesPerDay ?? HabitService.MaxTimesPerDay;
            if (count < 0 || count > target) local["count"] = [$"Must be between 0 and {target}."];
            var completed = l.Completed == true || count >= target;
            if (completed && count == 0) local["completed"] = ["Must be false when count is 0."];
            habit?.Logs.Add(new HabitLog { Date = l.Date ?? default, Count = count, Completed = completed });
            Nest(errors, path, local);
        }

        var marks = new List<DayMark>();
        var marked = new HashSet<DateOnly>();
        foreach (var (m, path) in Items(doc.DayMarks, "day_marks", errors))
        {
            if (m.Kind != "low_day") local["kind"] = ["Must be low_day."];
            var date = ValidDay(m.Date, today, earliestStart, marked, local);
            marks.Add(new DayMark { Date = date, Kind = DayMarkKind.LowDay });
            Nest(errors, path, local);
        }

        var key = accountKey ?? (doc.JournalKey is null ? null : new JournalKey());
        var moods = new List<Mood>();
        var moodById = new Dictionary<int, Mood>();
        foreach (var (m, path) in Items(doc.Moods, "moods", errors))
        {
            var cipher = JournalEndpoints.WriteForm(m.Encrypted, m.Label is not null || m.Emoji is not null, true, key, local);
            string? label = null, emoji = null;
            if (m.Encrypted is null)
            {
                label = JournalEndpoints.ValidLabel(m.Label, local);
                emoji = JournalEndpoints.ValidEmoji(m.Emoji, local);
            }
            var mood = new Mood
            {
                Label = label,
                Emoji = emoji,
                Archived = m.Archived == true,
                CreatedAt = now,
                CipherVersion = cipher?.Version,
                CipherIv = cipher?.Iv,
                CipherText = cipher?.Text,
            };
            if (m.Id is { } id && !moodById.TryAdd(id, mood)) local["id"] = [UniqueId];
            moods.Add(mood);
            Nest(errors, path, local);
        }

        var notes = new List<(DayNote, Mood?)>();
        var noted = new HashSet<DateOnly>();
        foreach (var (n, path) in Items(doc.DayNotes, "day_notes", errors))
        {
            var date = ValidDay(n.Date, today, earliestStart, noted, local);
            var cipher = JournalEndpoints.WriteForm(n.Encrypted, n.Text is not null || n.Mood is not null, true, key, local);
            string? text = null, builtIn = null;
            Mood? custom = null;
            if (n.Encrypted is null)
            {
                text = JournalEndpoints.ValidText(n.Text, local);
                if (n.Mood is null)
                {
                    if (text is null) local["text"] = ["Set text, mood or encrypted."];
                }
                else if (JournalEndpoints.BuiltInMoods.Contains(n.Mood)) builtIn = n.Mood;
                else if (!JournalEndpoints.TryParseCustomMood(n.Mood, out var moodId) || !moodById.TryGetValue(moodId, out custom))
                    local["mood"] = ["Must be low, meh, okay, good, great or custom:<id> of a mood in this file."];
            }
            notes.Add((new DayNote
            {
                Date = date,
                Text = text,
                Mood = builtIn,
                CipherVersion = cipher?.Version,
                CipherIv = cipher?.Iv,
                CipherText = cipher?.Text,
            }, custom));
            Nest(errors, path, local);
        }

        JournalKey? material = null;
        if (doc.JournalKey is { } journalKey)
        {
            material = JournalEndpoints.ValidKey(journalKey, local);
            Nest(errors, "journal_key", local);
        }

        return new ImportData(routines, habits, marks, moods, notes, material, doc.Settings?.GraceDaysPerWeek, doc.Settings?.Theme,
            doc.Settings?.SecondReminderMinutes ?? 0, doc.Settings?.ShowStreaks);
    }

    private const string NotEmptyMessage = "Import only works into an account without habits, routines, moods or journal entries.";

    private const string UniqueId = "Each id can be used once in this section.";

    /// <summary>The non-null items of a section with their error path; a null item adds an error.</summary>
    private static IEnumerable<(T Item, string Path)> Items<T>(List<T?>? items, string section, Dictionary<string, string[]> errors)
        where T : class
    {
        for (var i = 0; i < (items?.Count ?? 0); i++)
        {
            if (items![i] is { } item) yield return (item, $"{section}[{i}]");
            else errors[$"{section}[{i}]"] = ["Must be an object."];
        }
    }

    /// <summary>A journal or low day: the user's local today at the latest, the earliest imported habit start at the earliest, once per section.</summary>
    private static DateOnly ValidDay(DateOnly? value, DateOnly today, DateOnly? earliestStart, HashSet<DateOnly> seen,
        Dictionary<string, string[]> errors)
    {
        if (value is not { } date) errors["date"] = [Formats.DateMessage];
        else if (date > today) errors["date"] = ["Can't be after today."];
        else if (earliestStart is not { } start || date < start) errors["date"] = ["Can't be before your earliest habit's start."];
        else if (!seen.Add(date)) errors["date"] = ["Each date can be used once."];
        return value ?? default;
    }

    /// <summary>Moves <paramref name="local"/> into <paramref name="errors"/> under <paramref name="path"/>, keys in snake_case.</summary>
    private static void Nest(Dictionary<string, string[]> errors, string path, Dictionary<string, string[]> local)
    {
        foreach (var (field, messages) in local)
            errors[$"{path}.{JsonNamingPolicy.SnakeCaseLower.ConvertName(field)}"] = messages;
        local.Clear();
    }
}
