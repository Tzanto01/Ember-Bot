using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Quartz;

namespace Ember.Bot;

public sealed class EmberHostOptions
{
    public bool IncludeDiscordGateway { get; init; } = true;
    public Action<IServiceCollection, HostBuilderContext>? ConfigureServices { get; init; }
    public Action<DbContextOptionsBuilder, HostBuilderContext>? ConfigureDbContext { get; init; }
}

public static class AppHost
{
    public static IHostBuilder CreateHostBuilder(string[] args, EmberHostOptions? options = null)
    {
        options ??= new EmberHostOptions();

        return Host.CreateDefaultBuilder(args)
            .ConfigureAppConfiguration(config =>
            {
                config.AddJsonFile("appsettings.json", optional: true)
                    .AddJsonFile("appsettings.Development.json", optional: true)
                    .AddEnvironmentVariables();
            })
            .ConfigureServices((context, services) =>
            {
                services.AddDbContext<EmberDbContext>(dbOptions =>
                {
                    if (options.ConfigureDbContext is not null)
                    {
                        options.ConfigureDbContext(dbOptions, context);
                        return;
                    }

                    dbOptions.UseNpgsql(context.Configuration.GetConnectionString("DefaultConnection"));
                });

                services.AddSingleton(TimeProvider.System);
                services.AddScoped<HabitService>();

                services.AddQuartz(q =>
                {
                    q.AddJob<ReminderDispatchJob>(opts => opts.WithIdentity(ReminderDispatchJob.Key).StoreDurably());
                    q.AddTrigger(opts => opts
                        .ForJob(ReminderDispatchJob.Key)
                        .WithIdentity("reminder-dispatch-trigger", "reminders")
                        .WithCronSchedule("0 * * * * ?", x => x.InTimeZone(TimeZoneInfo.Utc)));

                    q.AddJob<WeeklySummaryJob>(opts => opts.WithIdentity(WeeklySummaryJob.Key).StoreDurably());
                    q.AddTrigger(opts => opts
                        .ForJob(WeeklySummaryJob.Key)
                        .WithIdentity("weekly-summary-trigger", "summaries")
                        .WithCronSchedule("0 0 * * * ?", x => x.InTimeZone(TimeZoneInfo.Utc)));

                    q.AddJob<MissedDayReflectionJob>(opts => opts.WithIdentity(MissedDayReflectionJob.Key).StoreDurably());
                    q.AddTrigger(opts => opts
                        .ForJob(MissedDayReflectionJob.Key)
                        .WithIdentity("missed-day-reflection-trigger", "reflections")
                        .WithCronSchedule("0 0 * * * ?", x => x.InTimeZone(TimeZoneInfo.Utc)));
                });
                services.AddQuartzHostedService(q => q.WaitForJobsToComplete = true);
                services.AddSingleton<IReminderChannel, DiscordDmReminderChannel>();

                if (options.IncludeDiscordGateway)
                {
                    var socketConfig = new DiscordSocketConfig
                    {
                        GatewayIntents = GatewayIntents.None
                    };

                    services.AddSingleton(socketConfig);
                    services.AddSingleton<DiscordSocketClient>();
                    services.AddSingleton(sp => new InteractionService(sp.GetRequiredService<DiscordSocketClient>()));
                    services.AddSingleton<IDiscordDmSender, DiscordDmSender>();
                    services.AddHostedService<BotService>();
                }
                else
                {
                    services.AddSingleton<IDiscordDmSender, NullDiscordDmSender>();
                }

                options.ConfigureServices?.Invoke(services, context);
            });
    }

    public static async Task InitializeAsync(IHost host, CancellationToken cancellationToken = default)
    {
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
        if (db.Database.ProviderName?.Contains("Sqlite", StringComparison.OrdinalIgnoreCase) == true)
            await db.Database.EnsureCreatedAsync(cancellationToken);
        else
            await db.Database.MigrateAsync(cancellationToken);

        var now = host.Services.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime;
        var habits = await db.Habits
            .Where(h => h.ReminderTime != null && h.NextReminderUtc == null)
            .Include(h => h.User)
            .ToListAsync(cancellationToken);

        foreach (var habit in habits)
        {
            var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
            habit.NextReminderUtc = TimezoneHelper.NextOccurrenceUtc(habit.ReminderTime!.Value, tz, now);
        }

        await db.SaveChangesAsync(cancellationToken);

        if (host.Services.GetService<InteractionService>() is { } interactions)
            interactions.InteractionExecuted += ActivatorUtilities.CreateInstance<DmPauseNotifier>(host.Services).OnInteractionExecutedAsync;
    }

    private sealed class NullDiscordDmSender : IDiscordDmSender
    {
        public Task<DeliveryOutcome> SendMessageAsync(
            ulong userId,
            string? text = null,
            Embed? embed = null,
            MessageComponent? components = null,
            CancellationToken cancellationToken = default)
            => Task.FromResult(DeliveryOutcome.UserNotFound);
    }
}
