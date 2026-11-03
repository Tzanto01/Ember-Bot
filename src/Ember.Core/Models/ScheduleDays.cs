namespace Ember.Core.Models;

/// <summary>The weekdays a <see cref="FrequencyType.Weekdays"/> habit is scheduled on.</summary>
[Flags]
public enum ScheduleDays
{
    None = 0,
    Mon = 1,
    Tue = 2,
    Wed = 4,
    Thu = 8,
    Fri = 16,
    Sat = 32,
    Sun = 64,
}
