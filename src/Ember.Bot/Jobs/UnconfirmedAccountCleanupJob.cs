using Ember.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Quartz;

namespace Ember.Bot.Jobs;

/// <summary>
/// Runs daily and deletes email signups that were never confirmed within
/// <see cref="HabitService.UnconfirmedAccountLifetime"/> (see <see cref="HabitService.DeleteStaleUnconfirmedAccountsAsync"/>),
/// and expired sign-in sessions (see <see cref="HabitService.DeleteExpiredSessionsAsync"/>).
/// </summary>
[DisallowConcurrentExecution]
public class UnconfirmedAccountCleanupJob : IJob
{
    public static readonly JobKey Key = new("unconfirmed-account-cleanup", "accounts");

    private readonly IServiceProvider _services;
    private readonly ILogger<UnconfirmedAccountCleanupJob> _logger;

    public UnconfirmedAccountCleanupJob(IServiceProvider services, ILogger<UnconfirmedAccountCleanupJob> logger)
    {
        _services = services;
        _logger = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        using var scope = _services.CreateScope();
        var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
        var deleted = await habits.DeleteStaleUnconfirmedAccountsAsync(context.CancellationToken);
        if (deleted > 0)
            _logger.LogInformation("UnconfirmedAccountCleanupJob: deleted {Count} unconfirmed accounts.", deleted);
        var sessions = await habits.DeleteExpiredSessionsAsync(context.CancellationToken);
        if (sessions > 0)
            _logger.LogInformation("UnconfirmedAccountCleanupJob: deleted {Count} expired sessions.", sessions);
    }
}
