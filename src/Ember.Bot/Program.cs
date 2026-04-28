using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Services;using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Quartz;

var host = Host.CreateDefaultBuilder(args)
    .ConfigureAppConfiguration(config =>
    {
        config.AddJsonFile("appsettings.json", optional: false)
              .AddJsonFile("appsettings.Development.json", optional: true)
              .AddEnvironmentVariables();
    })
    .ConfigureServices((context, services) =>
    {
        services.AddDbContext<EmberDbContext>(options =>
            options.UseNpgsql(context.Configuration.GetConnectionString("DefaultConnection")));

        services.AddScoped<HabitService>();

        // Quartz
        services.AddQuartz(q =>
        {
            q.AddJob<ReminderJob>(opts => opts.WithIdentity(ReminderJob.Key).StoreDurably());
            q.AddJob<SnoozeReminderJob>(opts => opts.WithIdentity(new Quartz.JobKey("snooze-template", "snoozes")).StoreDurably());

            // Weekly summary: every Sunday at 09:00 UTC
            q.AddJob<WeeklySummaryJob>(opts => opts.WithIdentity(WeeklySummaryJob.Key).StoreDurably());
            q.AddTrigger(opts => opts
                .ForJob(WeeklySummaryJob.Key)
                .WithIdentity("weekly-summary-trigger", "summaries")
                .WithCronSchedule("0 0 9 ? * SUN"));

            // Missed day reflection: every day at 10:00 UTC
            q.AddJob<MissedDayReflectionJob>(opts => opts.WithIdentity(MissedDayReflectionJob.Key).StoreDurably());
            q.AddTrigger(opts => opts
                .ForJob(MissedDayReflectionJob.Key)
                .WithIdentity("missed-day-reflection-trigger", "reflections")
                .WithCronSchedule("0 0 10 * * ?"));
        });
        services.AddQuartzHostedService(q => q.WaitForJobsToComplete = true);
        services.AddSingleton<ReminderScheduler>(sp =>
            new ReminderScheduler(sp.GetRequiredService<ISchedulerFactory>().GetScheduler().GetAwaiter().GetResult()));

        // Discord
        var socketConfig = new DiscordSocketConfig
        {
            GatewayIntents = GatewayIntents.None
        };
        services.AddSingleton(socketConfig);
        services.AddSingleton<DiscordSocketClient>();
        services.AddSingleton(sp => new InteractionService(sp.GetRequiredService<DiscordSocketClient>()));

        services.AddHostedService<BotService>();
    })
    .Build();

// Apply any pending migrations on startup
using (var scope = host.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<EmberDbContext>();
    await db.Database.MigrateAsync();

    // Restore reminder schedules for all habits that have a ReminderTime set,
    // grouped by user so we only look up each user's timezone once.
    var scheduler = host.Services.GetRequiredService<ReminderScheduler>();
    var habits = await db.Habits
        .Where(h => h.ReminderTime != null)
        .Include(h => h.User)
        .ToListAsync();

    foreach (var habit in habits)
    {
        var tz = TimezoneHelper.Find(habit.User.Timezone) ?? TimeZoneInfo.Utc;
        await scheduler.ScheduleAsync(habit, tz);
    }
}

await host.RunAsync();
