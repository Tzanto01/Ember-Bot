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

/// <summary>The wire names of <see cref="ScheduleDays"/>: <c>mon</c> … <c>sun</c>, Monday first.</summary>
public static class ScheduleDayNames
{
    /// <summary>The seven names, Monday first; index i is the flag <c>1 &lt;&lt; i</c>.</summary>
    public static IReadOnlyList<string> All => Names;

    private static readonly string[] Names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    /// <summary>The names of the set days, Monday first.</summary>
    public static List<string> ToNames(ScheduleDays days)
        => Names.Where((_, i) => ((int)days & (1 << i)) != 0).ToList();

    /// <summary>Parses distinct known names; false on an unknown or repeated name.</summary>
    public static bool TryParse(IEnumerable<string?> names, out ScheduleDays days)
    {
        days = ScheduleDays.None;
        foreach (var name in names)
        {
            var index = name is null ? -1 : Array.IndexOf(Names, name);
            var flag = (ScheduleDays)(1 << Math.Max(index, 0));
            if (index < 0 || days.HasFlag(flag)) return false;
            days |= flag;
        }
        return true;
    }
}
