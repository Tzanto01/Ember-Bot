using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Jobs;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
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

    // Restore reminder schedules for all habits that have a ReminderTime set
    var scheduler = host.Services.GetRequiredService<ReminderScheduler>();
    var habits = await db.Habits
        .Where(h => h.ReminderTime != null)
        .ToListAsync();

    foreach (var habit in habits)
        await scheduler.ScheduleAsync(habit);
}

await host.RunAsync();
