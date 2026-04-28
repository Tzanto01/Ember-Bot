namespace Ember.Bot.Services;

/// <summary>
/// Static catalogue of pre-built habit templates.
/// No database changes needed — purely presentational.
/// </summary>
public static class HabitTemplates
{
    public record Template(
        string Key,
        string DisplayName,
        string Description,
        string SuggestedReminderLabel,
        TimeOnly SuggestedReminderTime,
        FrequencyHint Frequency = FrequencyHint.Daily,
        int WeeklyTarget = 3);

    public enum FrequencyHint { Daily, Weekly }

    public static readonly IReadOnlyList<Template> All = new[]
    {
        new Template("morning_routine",  "☀️ Morning Routine",   "Start the day with intention",         "08:00 AM", new TimeOnly(8,  0)),
        new Template("medication",       "💊 Medication",         "Take meds on schedule",                "09:00 AM", new TimeOnly(9,  0)),
        new Template("hydration",        "💧 Hydration",          "Drink enough water today",             "10:00 AM", new TimeOnly(10, 0)),
        new Template("exercise",         "🏃 Exercise",           "Move your body — any amount counts",   "06:00 PM", new TimeOnly(18, 0), FrequencyHint.Weekly, 3),
        new Template("sleep",            "😴 Sleep",              "Wind down and get to bed on time",     "10:00 PM", new TimeOnly(22, 0)),
        new Template("journaling",       "📓 Journaling",         "Reflect on your day in writing",       "09:00 PM", new TimeOnly(21, 0)),
        new Template("reading",          "📚 Reading",            "Read for at least 10 minutes",         "08:00 PM", new TimeOnly(20, 0)),
        new Template("no_phone_morning", "📵 Phone-Free Morning", "No phone for the first 30 min",        "07:30 AM", new TimeOnly(7,  30)),
        new Template("outside",          "🌿 Go Outside",         "Get some fresh air and daylight",      "12:00 PM", new TimeOnly(12, 0), FrequencyHint.Weekly, 5),
        new Template("deep_work",        "🧠 Deep Work",          "One focused work session",             "09:00 AM", new TimeOnly(9,  0), FrequencyHint.Weekly, 5),
    };

    public static Template? Find(string key) =>
        All.FirstOrDefault(t => t.Key == key);
}
