using System.Reflection;
using Discord.Interactions;
using Ember.Bot.Modules;
using FluentAssertions;
using Microsoft.Extensions.Configuration;

namespace Ember.Tests;

public class HelpModuleTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values)
        => new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    [Fact]
    public void Help_links_the_privacy_policy_and_imprint_of_the_web_app()
    {
        var embed = HelpModule.HelpEmbed(Ember.Bot.BotTexts.English, Config(("Ember:PrivacyPolicyUrl", "https://ember.example/legal/privacy")));

        embed.Fields.Should().ContainSingle(f => f.Name == "Legal").Which.Value.Should()
            .Be("[Privacy policy](https://ember.example/legal/privacy) · [Imprint](https://ember.example/legal/imprint)");
    }

    [Fact]
    public void Help_links_only_the_privacy_policy_when_it_is_hosted_elsewhere()
    {
        var embed = HelpModule.HelpEmbed(Ember.Bot.BotTexts.English, Config(("Ember:PrivacyPolicyUrl", "https://policies.example/ember")));

        embed.Fields.Should().ContainSingle(f => f.Name == "Legal").Which.Value.Should()
            .Be("[Privacy policy](https://policies.example/ember)");
    }

    [Fact]
    public void Help_shows_no_legal_links_without_a_privacy_policy_url()
    {
        var embed = HelpModule.HelpEmbed(Ember.Bot.BotTexts.English, Config());

        embed.Fields.Should().NotContain(f => f.Name == "Legal");
        embed.Fields.Select(f => f.Value).Should().NotContain(v => v.Contains("Privacy policy"));
    }

    [Fact]
    public void Help_lists_every_slash_command()
    {
        var commands = typeof(HelpModule).Assembly.GetTypes()
            .SelectMany(t => t.GetMethods().Select(m => (Group: t.GetCustomAttribute<GroupAttribute>()?.Name,
                Command: m.GetCustomAttribute<SlashCommandAttribute>()?.Name)))
            .Where(c => c.Command is not null)
            .Select(c => c.Group is null ? $"/{c.Command}" : $"/{c.Group} {c.Command}")
            .Where(c => c != "/help")
            .ToList();

        var text = string.Join("\n", HelpModule.HelpEmbed(Ember.Bot.BotTexts.English, Config()).Fields.Select(f => f.Value));

        commands.Should().HaveCountGreaterThan(15);
        commands.Should().OnlyContain(c => text.Contains($"`{c}`"));
    }

    [Fact]
    public void Help_and_the_stop_texts_speak_german_for_german_users()
    {
        var de = Ember.Bot.BotTexts.For("de");
        var text = string.Join("\n", HelpModule.HelpEmbed(de, Config()).Fields.Select(f => f.Value));

        text.Should().Contain("`/reminders");
        foreach (var key in new[] { "discordreminders.stop", "discordreminders.command.off" })
            de.Get(key).Should().NotBe(Ember.Bot.BotTexts.English.Get(key));
    }
}
