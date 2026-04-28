using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Data;
using Ember.Bot.Modules;
using Microsoft.EntityFrameworkCore;
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
    private Timer? _statusTimer;

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
        _statusTimer?.Dispose();
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

        // Set status immediately, then rotate every 30 minutes
        await UpdateStatusAsync();
        _statusTimer = new Timer(_ => _ = UpdateStatusAsync(), null,
            TimeSpan.FromMinutes(30), TimeSpan.FromMinutes(30));
    }

    private async Task UpdateStatusAsync()
    {
        try
        {
            using var scope = _services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
            var habitCount = await db.Habits.CountAsync();

            var (activity, status) = habitCount switch
            {
                0 => ("habits take shape 🌱", UserStatus.Online),
                1 => ("1 habit tracked 🔥", UserStatus.Online),
                _ => ($"{habitCount} habits tracked 🔥", UserStatus.Online),
            };

            await _client.SetStatusAsync(status);
            await _client.SetActivityAsync(new Game(activity, ActivityType.Watching));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to update bot status.");
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
