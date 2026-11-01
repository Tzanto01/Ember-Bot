namespace Ember.Core.Services;

/// <summary>Outcome of <see cref="HabitService.MergeBotOnlyAccountAsync"/>.</summary>
public enum AccountMergeResult
{
    /// <summary>The bot-only account was merged into the target and deleted.</summary>
    Merged,

    /// <summary>
    /// Nothing changed: the source is no longer a bot-only account owning the Discord login, or the target is missing
    /// or already has a Discord login.
    /// </summary>
    Conflict,
}

/// <summary>What a merge of a bot-only account would move.</summary>
public sealed record MergePreview(int Habits, int Logs, int DayMarks, IReadOnlyList<string> HabitNames);
