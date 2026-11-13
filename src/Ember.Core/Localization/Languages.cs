using System.Net.Http.Headers;

namespace Ember.Core.Localization;

/// <summary>The languages Ember speaks (<c>en</c>, <c>de</c>) and how a locale maps to one of them.</summary>
public static class Languages
{
    public const string English = "en";
    public const string German = "de";

    /// <summary>The values <see cref="Models.User.Language"/> may hold.</summary>
    public static readonly IReadOnlySet<string> All = new HashSet<string> { English, German };

    /// <summary><see cref="German"/> for <c>de</c> or <c>de-*</c> (any case), else <see cref="English"/>.</summary>
    public static string FromLocale(string? locale)
        => locale is not null && (locale.Equals(German, StringComparison.OrdinalIgnoreCase)
            || locale.StartsWith(German + "-", StringComparison.OrdinalIgnoreCase)) ? German : English;

    /// <summary>
    /// The language of an <c>Accept-Language</c> header: its first range by quality (ties keep header order) that is
    /// <c>en</c>, <c>de</c> or a sub-tag of one; <see cref="English"/> when none is, or the header is missing or malformed.
    /// </summary>
    public static string FromAcceptLanguage(string? header)
    {
        if (string.IsNullOrWhiteSpace(header)) return English;
        var ranges = new List<(string Tag, double Quality)>();
        foreach (var part in header.Split(','))
            if (StringWithQualityHeaderValue.TryParse(part.Trim(), out var range) && (range.Quality ?? 1) > 0)
                ranges.Add((range.Value, range.Quality ?? 1));
        foreach (var (tag, _) in ranges.OrderByDescending(r => r.Quality))
            if (tag.Equals(English, StringComparison.OrdinalIgnoreCase) || tag.StartsWith(English + "-", StringComparison.OrdinalIgnoreCase)
                || FromLocale(tag) == German)
                return FromLocale(tag);
        return English;
    }
}
