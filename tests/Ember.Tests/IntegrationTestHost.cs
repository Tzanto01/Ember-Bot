using Discord;
using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Services;
using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Quartz;
using Quartz.Logging;

namespace Ember.Tests;

public sealed class IntegrationTestHost : IAsyncDisposable
{
    private readonly SqliteConnection _connection;

    private IntegrationTestHost(IHost host, SqliteConnection connection, TestDiscordDmSender discord)
    {
        Host = host;
        _connection = connection;
        Discord = discord;
    }

    public IHost Host { get; }
    public TestDiscordDmSender Discord { get; }

    public static async Task<IntegrationTestHost> CreateAsync(bool initialize = true, bool start = true)
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var discord = new TestDiscordDmSender();
        var host = AppHost.CreateHostBuilder([], new EmberHostOptions
        {
            IncludeDiscordGateway = false,
            ConfigureDbContext = (options, _) => options.UseSqlite(connection),
            ConfigureServices = (services, _) =>
            {
                services.AddSingleton(discord);
                services.AddSingleton<IDiscordDmSender>(sp => sp.GetRequiredService<TestDiscordDmSender>());
            }
        }).Build();

        var harness = new IntegrationTestHost(host, connection, discord);

        LogContext.SetCurrentLogProvider(host.Services.GetRequiredService<ILoggerFactory>());

        if (initialize)
            await AppHost.InitializeAsync(host);

        if (start)
            await host.StartAsync();

        return harness;
    }

    public async Task EnsureCreatedAsync()
    {
        await using var scope = Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task<T> WithScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = Host.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    public async Task WithScopeAsync(Func<IServiceProvider, Task> action)
    {
        await using var scope = Host.Services.CreateAsyncScope();
        await action(scope.ServiceProvider);
    }

    public async Task<ITrigger?> GetTriggerAsync(string name, string group)
    {
        var scheduler = await WithScopeAsync(sp => sp.GetRequiredService<ISchedulerFactory>().GetScheduler());
        return await scheduler.GetTrigger(new TriggerKey(name, group));
    }

    public async Task WaitForDmCountAsync(int expectedCount, int timeoutMs = 3000)
    {
        var start = Environment.TickCount64;
        while (Environment.TickCount64 - start < timeoutMs)
        {
            if (Discord.Messages.Count >= expectedCount)
                return;

            await Task.Delay(50);
        }

        Discord.Messages.Count.Should().BeGreaterThanOrEqualTo(expectedCount);
    }

    public async ValueTask DisposeAsync()
    {
        await Host.StopAsync();
        Host.Dispose();
        LogContext.SetCurrentLogProvider(NullLoggerFactory.Instance);
        await _connection.DisposeAsync();
    }
}

public sealed record SentDiscordDm(ulong UserId, string? Text, Embed? Embed, MessageComponent? Components);

public sealed class TestDiscordDmSender : IDiscordDmSender
{
    private readonly List<SentDiscordDm> _messages = [];
    private readonly Lock _gate = new();

    public IReadOnlyList<SentDiscordDm> Messages
    {
        get
        {
            lock (_gate)
            {
                return _messages.ToList();
            }
        }
    }

    public Task<bool> SendMessageAsync(
        ulong userId,
        string? text = null,
        Embed? embed = null,
        MessageComponent? components = null,
        CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _messages.Add(new SentDiscordDm(userId, text, embed, components));
        }

        return Task.FromResult(true);
    }

    public void Clear()
    {
        lock (_gate)
        {
            _messages.Clear();
        }
    }
}
