using Discord;
using Discord.Interactions;
using Discord.WebSocket;
using Ember.Bot;
using Ember.Bot.Data;
using Ember.Bot.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

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

        var socketConfig = new DiscordSocketConfig
        {
            GatewayIntents = GatewayIntents.None // slash commands don't need privileged intents
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
}

await host.RunAsync();
