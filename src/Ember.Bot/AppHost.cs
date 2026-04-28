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
                config.AddJsonFile("appsettings.json", optional: !options.IncludeDiscordGateway)
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

                services.AddScoped<HabitService>();

                services.AddQuartz(q =>
                {
                    q.AddJob<ReminderJob>(opts => opts.WithIdentity(ReminderJob.Key).StoreDurably());
                    q.AddJob<SnoozeReminderJob>(opts => opts.WithIdentity(new JobKey("snooze-template", "snoozes")).StoreDurably());

                    q.AddJob<WeeklySummaryJob>(opts => opts.WithIdentity(WeeklySummaryJob.Key).StoreDurably());
                    q.AddTrigger(opts => opts
                        .ForJob(WeeklySummaryJob.Key)
                        .WithIdentity("weekly-summary-trigger", "summaries")
                        .WithCronSchedule("0 0 9 ? * SUN"));

                    q.AddJob<MissedDayReflectionJob>(opts => opts.WithIdentity(MissedDayReflectionJob.Key).StoreDurably());
                    q.AddTrigger(opts => opts
                        .ForJob(MissedDayReflectionJob.Key)
                        .WithIdentity("missed-day-reflection-trigger", "reflections")
                        .WithCronSchedule("0 0 10 * * ?"));
                });
                services.AddQuartzHostedService(q => q.WaitForJobsToComplete = true);
                services.AddSingleton<ReminderScheduler>();

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

        var scheduler = host.Services.GetRequiredService<ReminderScheduler>();
        var habits = await db.Habits
            .Where(h => h.ReminderTime != null)
            .Include(h => h.User)
            .ToListAsync(cancellationToken);

        foreach (var habit in habits)
        {
            var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
            await scheduler.ScheduleAsync(habit, tz);
        }
    }

    private sealed class NullDiscordDmSender : IDiscordDmSender
    {
        public Task<bool> SendMessageAsync(
            ulong userId,
            string? text = null,
            Embed? embed = null,
            MessageComponent? components = null,
            CancellationToken cancellationToken = default)
            => Task.FromResult(false);
    }
}
