using System.Reflection;
using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot;
using Ember.Bot.Modules;
using Ember.Core.Data;
using Ember.Core.Localization;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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

    private static readonly IConfiguration NoConfig = new ConfigurationBuilder().Build();

    [Theory]
    [InlineData("de", "en-US", "Ember: alle Befehle", "Erste Schritte")]
    [InlineData("en", "de", "Ember: Command Guide", "Getting started")]
    public async Task Help_follows_the_account_language_over_the_Discord_locale(string accountLanguage, string locale, string title, string firstSection)
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);
        var embed = await host.WithScopeAsync(async sp =>
        {
            var habits = sp.GetRequiredService<HabitService>();
            await habits.ResolveOrCreateDiscordUserAsync(7, accountLanguage);
            return HelpModule.HelpEmbed(await BotTexts.ForAsync(habits, FakeInteraction.Create(7, locale)), NoConfig);
        });

        embed.Title.Should().Be(title);
        embed.Fields[0].Name.Should().Be(firstSection);
    }

    [Theory]
    [InlineData("de", "Eine kurze Frage 💙", "Ich stimme zu")]
    [InlineData("en-GB", "One quick question 💙", "I agree")]
    public async Task Consent_prompt_for_someone_Ember_does_not_know_yet_follows_their_Discord_locale(string locale, string title, string agree)
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);
        var interaction = FakeInteraction.Create(8, locale);

        await host.WithScopeAsync(sp =>
            ConsentModule.RespondWithPromptAsync(FakeContext.Create(interaction), NoConfig, sp.GetRequiredService<HabitService>()));

        var reply = ((FakeInteraction)(object)interaction).Responses.Single();
        ((Embed)reply["embed"]!).Title.Should().Be(title);
        ((MessageComponent)reply["components"]!).Components.OfType<ActionRowComponent>().SelectMany(r => r.Components)
            .OfType<ButtonComponent>().First().Label.Should().Be(agree);
        (await host.WithScopeAsync(sp => sp.GetRequiredService<EmberDbContext>().Users.CountAsync())).Should().Be(0);
    }

    public static TheoryData<string> Creators => ["consent", "grace", "timezone", "second-reminder", "streaks"];

    private static Task CreateThroughBotAsync(HabitService habits, string creator, ulong discordId, string locale)
    {
        var language = Languages.FromLocale(locale);
        return creator switch
        {
            "consent" => ConsentModule.TryAnswerAsync(habits, discordId.ToString(), discordId, agreed: true, language),
            "grace" => habits.SetGraceDaysAsync(discordId, 2, language),
            "timezone" => habits.SetTimezoneAsync(discordId, "Europe/Berlin", language),
            "second-reminder" => habits.SetSecondReminderMinutesAsync(discordId, 30, language),
            _ => habits.SetShowStreaksAsync(discordId, true, language),
        };
    }

    [Theory]
    [MemberData(nameof(Creators))]
    public async Task An_account_the_bot_creates_takes_the_language_of_the_Discord_locale_and_never_overwrites_it(string creator)
    {
        await using var host = await IntegrationTestHost.CreateAsync(start: false);

        await host.WithScopeAsync(sp => CreateThroughBotAsync(sp.GetRequiredService<HabitService>(), creator, 21, "de"));
        await host.WithScopeAsync(sp => CreateThroughBotAsync(sp.GetRequiredService<HabitService>(), creator, 22, "en-US"));
        await host.WithScopeAsync(sp => CreateThroughBotAsync(sp.GetRequiredService<HabitService>(), creator, 21, "en-US"));

        var languages = await host.WithScopeAsync(async sp =>
        {
            var habits = sp.GetRequiredService<HabitService>();
            return (await habits.GetLanguageAsync(await habits.FindDiscordUserAsync(21)), await habits.GetLanguageAsync(await habits.FindDiscordUserAsync(22)));
        });
        languages.Should().Be(("de", "en"));
    }

    [Fact]
    public void German_history_grid_shows_German_day_and_date_labels()
    {
        var day = new DateOnly(2026, 11, 13);
        var grid = HistoryModule.BuildGrid(BotTexts.For("de"), 1, 2, [new HabitDay(day, DayState.NotDone, null, 0)], new HashSet<DateOnly> { day });
        var components = grid.Components.OfType<ActionRowComponent>().SelectMany(r => r.Components).ToList();

        components.OfType<ButtonComponent>().Single().Label.Should().Be("Fr 13. ▫️");
        var option = components.OfType<SelectMenuComponent>().Single().Options.Single();
        option.Label.Should().Be("Fr 13. Nov.");
        option.Description.Should().Be("🌙 Tief, zum Entfernen wählen");
    }

    /// <summary>An interaction from Discord user <c>id</c> with Discord locale <c>locale</c> that records what it was answered with.</summary>
    public class FakeInteraction : DispatchProxy
    {
        private ulong _userId;
        private string _locale = "";
        public List<Dictionary<string, object?>> Responses { get; } = [];

        public static IDiscordInteraction Create(ulong userId, string locale)
        {
            var proxy = DispatchProxy.Create<IDiscordInteraction, FakeInteraction>();
            var fake = (FakeInteraction)(object)proxy;
            fake._userId = userId;
            fake._locale = locale;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            switch (method!.Name)
            {
                case "get_UserLocale": return _locale;
                case "get_User": return FakeUser.Create(_userId);
                case "RespondAsync":
                    Responses.Add(method.GetParameters().Select((p, i) => (p.Name!, args![i])).ToDictionary(a => a.Item1, a => a.Item2));
                    return Task.CompletedTask;
                default: throw new NotSupportedException(method.Name);
            }
        }
    }

    public class FakeUser : DispatchProxy
    {
        private ulong _id;

        public static IUser Create(ulong id)
        {
            var proxy = DispatchProxy.Create<IUser, FakeUser>();
            ((FakeUser)(object)proxy)._id = id;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
            => method!.Name == "get_Id" ? _id : throw new NotSupportedException(method.Name);
    }

    public class FakeContext : DispatchProxy
    {
        private IDiscordInteraction _interaction = null!;

        public static IInteractionContext Create(IDiscordInteraction interaction)
        {
            var proxy = DispatchProxy.Create<IInteractionContext, FakeContext>();
            ((FakeContext)(object)proxy)._interaction = interaction;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method!.Name switch
        {
            "get_Interaction" => _interaction,
            "get_User" => _interaction.User,
            _ => throw new NotSupportedException(method.Name),
        };
    }
}
