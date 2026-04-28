using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Modules;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System.Reflection;

namespace Ember.Bot;

public class BotService : IHostedService
{
    private readonly DiscordSocketClient _client;
    private readonly InteractionService _interactions;
    private readonly IServiceProvider _services;
    private readonly IConfiguration _config;
    private readonly ILogger<BotService> _logger;

    public BotService(
        DiscordSocketClient client,
        InteractionService interactions,
        IServiceProvider services,
        IConfiguration config,
        ILogger<BotService> logger)
    {
        _client = client;
        _interactions = interactions;
        _services = services;
        _config = config;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _client.Log += LogAsync;
        _interactions.Log += LogAsync;

        // Register interaction modules from this assembly
        await _interactions.AddModulesAsync(Assembly.GetEntryAssembly(), _services);

        _client.Ready += OnReadyAsync;
        _client.InteractionCreated += OnInteractionAsync;

        var token = _config["BotToken"]
            ?? throw new InvalidOperationException("BotToken is not configured.");

        await _client.LoginAsync(TokenType.Bot, token);
        await _client.StartAsync();
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await _client.StopAsync();
    }

    private async Task OnReadyAsync()
    {
        var devGuildIdStr = _config["DevGuildId"];
        if (ulong.TryParse(devGuildIdStr, out var devGuildId))
        {
            // Clear any lingering global commands so they don't appear alongside guild commands
            await _client.BulkOverwriteGlobalApplicationCommandsAsync([]);
            _logger.LogInformation("Bot is ready. Registering slash commands to dev guild {GuildId}...", devGuildId);
            await _interactions.RegisterCommandsToGuildAsync(devGuildId);
            _logger.LogInformation("Slash commands registered to dev guild.");
        }
        else
        {
            _logger.LogInformation("Bot is ready. Registering slash commands globally...");
            await _interactions.RegisterCommandsGloballyAsync();
            _logger.LogInformation("Slash commands registered globally.");
        }
    }

    private async Task OnInteractionAsync(SocketInteraction interaction)
    {
        var ctx = new SocketInteractionContext(_client, interaction);
        await _interactions.ExecuteCommandAsync(ctx, _services);
    }

    private Task LogAsync(LogMessage msg)
    {
        var level = msg.Severity switch
        {
            LogSeverity.Critical => LogLevel.Critical,
            LogSeverity.Error    => LogLevel.Error,
            LogSeverity.Warning  => LogLevel.Warning,
            LogSeverity.Info     => LogLevel.Information,
            _                    => LogLevel.Debug
        };
        _logger.Log(level, msg.Exception, "{Source}: {Message}", msg.Source, msg.Message);
        return Task.CompletedTask;
    }
}
