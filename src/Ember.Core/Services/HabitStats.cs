namespace Ember.Core.Services;

/// <summary>
/// A habit's stats as the clients show them (see <see cref="HabitService.StatsOn"/>). Weekly habits have <c>Streak</c>,
/// <c>GraceUsed</c> and <c>BestStreak</c> null and <c>Week</c> set; other habits the reverse.
/// </summary>
public sealed record HabitStats(int? Streak, int? GraceUsed, int? BestStreak, int Last7, (int Done, int Target)? Week);
