using System.Text.RegularExpressions;
using System.Xml.Linq;
using Ember.Bot;
using Ember.Core.Localization;
using FluentAssertions;

namespace Ember.Tests;

public class LocalizationTests
{
    private static readonly Regex Placeholder = new(@"\{\d+[^}]*\}");

    private static readonly Regex GermanNeverWords = new(
        @"\b(behandel\w*|behandl\w*|heilen|heilt|geheilt|heilung\w*|therapie\w*|therapeut\w*|klinisch\w*|diagnos\w*|vorbeug\w*|verhinder\w*|linder\w*|reduzier\w*|bewiesen\w*|nachgewiesen\w*)\b",
        RegexOptions.IgnoreCase);

    public static TheoryData<string> ResourceFiles()
    {
        var data = new TheoryData<string>();
        foreach (var file in Directory.EnumerateFiles(Path.Combine(RepoRoot(), "src"), "*.resx", SearchOption.AllDirectories)
                     .Where(f => !f.EndsWith(".de.resx", StringComparison.Ordinal) && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
                     .Order())
            data.Add(Path.GetRelativePath(RepoRoot(), file));
        return data;
    }

    [Fact]
    public void EveryResourceFileIsFound() => ResourceFiles().Should().HaveCountGreaterThanOrEqualTo(4);

    [Theory]
    [MemberData(nameof(ResourceFiles))]
    public void GermanHasEveryKeyWithTheSamePlaceholders(string file)
    {
        var english = Entries(Path.Combine(RepoRoot(), file));
        var german = Entries(Path.Combine(RepoRoot(), file[..^".resx".Length] + ".de.resx"));

        german.Keys.Should().BeEquivalentTo(english.Keys);
        foreach (var (key, text) in german)
        {
            text.Should().NotBeNullOrWhiteSpace(key);
            Placeholder.Matches(text).Select(m => m.Value).Order()
                .Should().Equal(Placeholder.Matches(english[key]).Select(m => m.Value).Order(), key);
        }
    }

    [Fact]
    public void NoKeyIsInTwoResourceFiles()
    {
        var owners = ResourceFiles().Select(row => (string)row[0])
            .SelectMany(file => Entries(Path.Combine(RepoRoot(), file)).Keys.Select(key => (key, file)));
        owners.GroupBy(o => o.key).Where(g => g.Count() > 1).Select(g => g.Key).Should().BeEmpty();
    }

    [Theory]
    [MemberData(nameof(ResourceFiles))]
    public void GermanKeepsTheTone(string file)
    {
        foreach (var (key, text) in Entries(Path.Combine(RepoRoot(), file[..^".resx".Length] + ".de.resx")))
        {
            text.Should().NotContainAny(["—", "–", " - "], key);
            GermanNeverWords.IsMatch(text).Should().BeFalse($"{key} is wellness wording: \"{text}\"");
        }
    }

    [Theory]
    [InlineData("de", "de")]
    [InlineData("de-AT", "de")]
    [InlineData("DE-ch", "de")]
    [InlineData("en-US", "en")]
    [InlineData("fr", "en")]
    [InlineData("dev", "en")]
    [InlineData(null, "en")]
    public void LocaleMapsToALanguage(string? locale, string language) => Languages.FromLocale(locale).Should().Be(language);

    [Theory]
    [InlineData("de-DE,de;q=0.9,en;q=0.8", "de")]
    [InlineData("en-US,en;q=0.9,de;q=0.8", "en")]
    [InlineData("fr-FR,fr;q=0.9,de;q=0.8", "de")]
    [InlineData("en;q=0.5,de-AT;q=0.9", "de")]
    [InlineData("fr", "en")]
    [InlineData("", "en")]
    [InlineData(null, "en")]
    [InlineData(";;;", "en")]
    public void AcceptLanguageMapsToALanguage(string? header, string language)
        => Languages.FromAcceptLanguage(header).Should().Be(language);

    [Fact]
    public void TextsSpeakTheUsersLanguage()
    {
        BotTexts.For("de").Get("reminder.skip").Should().Be("Heute auslassen");
        BotTexts.For("en").Get("reminder.skip").Should().Be("Skip for today");
        BotTexts.For("fr").Language.Should().Be("en");
        BotTexts.For("de").Plural("habit.streak", 1).Should().Be("Streak: **1** Tag");
        BotTexts.For("de").Plural("habit.streak", 3).Should().Be("Streak: **3** Tage");
    }

    [Fact]
    public void AnUnknownKeyFails()
        => FluentActions.Invoking(() => BotTexts.English.Get("no.such.key")).Should().Throw<KeyNotFoundException>();

    private static Dictionary<string, string> Entries(string path)
        => XDocument.Load(path).Root!.Elements("data")
            .ToDictionary(d => (string)d.Attribute("name")!, d => (string?)d.Element("value") ?? "");

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "Ember.slnx"))) return dir.FullName;
        throw new InvalidOperationException("Ember.slnx not found above the test output directory.");
    }
}
