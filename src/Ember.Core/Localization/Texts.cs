using System.Globalization;
using System.Resources;

namespace Ember.Core.Localization;

/// <summary>
/// User-facing text in one language, looked up by key in one or more <c>.resx</c> resources (first match wins). The culture
/// is always the user's language, never the server's. A key missing in German falls back to the English base file.
/// </summary>
public sealed class Texts(string language, params ResourceManager[] sources)
{
    /// <summary>The resources in <c>Ember.Core/Resources/Strings.resx</c>, text shared by the API and the bot.</summary>
    public static readonly ResourceManager CoreResources = new("Ember.Core.Resources.Strings", typeof(Texts).Assembly);

    /// <summary>The user's language, <see cref="Languages.English"/> or <see cref="Languages.German"/>.</summary>
    public string Language { get; } = Languages.All.Contains(language) ? language : Languages.English;

    /// <summary>The culture for <see cref="Language"/>, for numbers and dates shown to the user.</summary>
    public CultureInfo Culture => CultureInfo.GetCultureInfo(Language);

    /// <summary>The text for <paramref name="key"/>.</summary>
    /// <exception cref="KeyNotFoundException">No resource has the key.</exception>
    public string Get(string key)
    {
        foreach (var source in sources)
            if (source.GetString(key, Culture) is { } text) return text;
        throw new KeyNotFoundException($"No text for key '{key}'.");
    }

    /// <summary>The text for <paramref name="key"/> with <c>{0}</c>, <c>{1}</c>, … filled in, formatted in <see cref="Culture"/>.</summary>
    public string Format(string key, params object?[] args) => string.Format(Culture, Get(key), args);

    /// <summary>
    /// <c>{key}.one</c> when <paramref name="count"/> is 1, else <c>{key}.other</c>, formatted with <paramref name="count"/> as
    /// <c>{0}</c> and <paramref name="args"/> from <c>{1}</c> on.
    /// </summary>
    public string Plural(string key, int count, params object?[] args)
        => Format(count == 1 ? key + ".one" : key + ".other", [count, .. args]);
}
