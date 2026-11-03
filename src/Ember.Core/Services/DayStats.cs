namespace Ember.Core.Services;

/// <summary>One local day across all of a user's habits (see <see cref="HabitService.DayStatsOn"/>).</summary>
public sealed record DayStats(DateOnly Date, int Scheduled, int Done, int Partial, bool ShowedUp);
