using System.Reflection;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;

namespace Ember.Tests;

public class BotLanguageTests
{
    /// <summary>The slash commands as the bot registers them with Discord (Discord.Net's own conversion, localizations applied).</summary>
    private static async Task<List<ApplicationCommandProperties>> RegisteredCommandsAsync()
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);
        using var scope = host.Host.Services.CreateScope();
        using var interactions = new InteractionService(new DiscordSocketClient(), AppHost.InteractionConfig());
        await interactions.AddModulesAsync(typeof(AppHost).Assembly, scope.ServiceProvider);
        var toProps = typeof(InteractionService).Assembly.GetType("Discord.Interactions.ApplicationCommandRestUtil")!
            .GetMethod("ToApplicationCommandProps", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic, [typeof(ModuleInfo), typeof(bool)])!;
        return interactions.Modules.Where(m => !m.IsSubModule)
            .SelectMany(m => (IReadOnlyCollection<ApplicationCommandProperties>)toProps.Invoke(null, [m, false])!)
            .ToList();
    }

    private static IDictionary<string, string>? Dictionary(IReadOnlyDictionary<string, string>? value) => value?.ToDictionary();

    [Fact]
    public async Task Every_slash_command_group_option_and_choice_has_a_German_description_but_keeps_its_English_name()
    {
        var commands = (await RegisteredCommandsAsync()).Cast<SlashCommandProperties>().ToList();
        var described = new List<(string Path, string English, IDictionary<string, string>? Localized)>();
        var named = new List<(string Path, IDictionary<string, string>? Localized)>();

        void Walk(string path, IEnumerable<ApplicationCommandOptionProperties>? options)
        {
            foreach (var option in options ?? [])
            {
                var optionPath = $"{path} {option.Name}";
                described.Add((optionPath, option.Description, option.DescriptionLocalizations));
                named.Add((optionPath, option.NameLocalizations));
                foreach (var choice in option.Choices ?? [])
                    described.Add(($"{optionPath} = {choice.Name}", choice.Name, choice.NameLocalizations));
                Walk(optionPath, option.Options);
            }
        }

        foreach (var command in commands)
        {
            described.Add((command.Name.Value, command.Description.Value, Dictionary(command.DescriptionLocalizations)));
            named.Add((command.Name.Value, Dictionary(command.NameLocalizations)));
            Walk(command.Name.Value, command.Options.IsSpecified ? command.Options.Value : null);
        }

        commands.Select(c => c.Name.Value).Should().Contain(["habit", "timezone", "privacy", "export", "feedback", "help", "link"]);
        described.Should().HaveCountGreaterThan(30);
        foreach (var (path, english, localized) in described)
        {
            localized.Should().NotBeNull(path).And.ContainKey("de", path);
            localized!["de"].Should().NotBeNullOrWhiteSpace(path);
            if (english != "JSON") localized["de"].Should().NotBe(english, path);
        }
        named.Should().OnlyContain(n => n.Localized == null || n.Localized.Count == 0);
    }
}
