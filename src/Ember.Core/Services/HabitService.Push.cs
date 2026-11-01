using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>Reminder channels and Web Push subscriptions.</summary>
public partial class HabitService
{
    /// <summary>Most push subscriptions a single user keeps; saving another drops the least recently saved.</summary>
    public const int MaxPushSubscriptionsPerUser = 10;

    /// <summary>The lowercase names of the set channels (<c>discord</c>, <c>webpush</c>), in flag order.</summary>
    public static List<string> ReminderChannelNames(ReminderChannels channels)
        => Enum.GetValues<ReminderChannels>()
            .Where(c => c != ReminderChannels.None && channels.HasFlag(c))
            .Select(c => c.ToString().ToLowerInvariant())
            .ToList();

    /// <summary>
    /// Stores the browser subscription for the user. An endpoint already stored (for this or another account) is moved to the
    /// user with the new keys and counts as saved now. Afterwards the user keeps at most <see cref="MaxPushSubscriptionsPerUser"/>
    /// subscriptions; the least recently saved ones beyond that are deleted.
    /// </summary>
    public async Task SavePushSubscriptionAsync(Guid userId, string endpoint, string p256dh, string auth)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        var subscription = await _db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == endpoint);
        if (subscription is null)
        {
            subscription = new PushSubscription { Endpoint = endpoint };
            _db.PushSubscriptions.Add(subscription);
        }

        subscription.UserId = userId;
        subscription.P256dh = p256dh;
        subscription.Auth = auth;
        subscription.CreatedAt = now;
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException) when (_db.Entry(subscription).State == EntityState.Added)
        {
            _db.Entry(subscription).State = EntityState.Detached;
            await _db.PushSubscriptions
                .Where(s => s.Endpoint == endpoint)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.UserId, userId)
                    .SetProperty(p => p.P256dh, p256dh)
                    .SetProperty(p => p.Auth, auth)
                    .SetProperty(p => p.CreatedAt, now));
        }

        var excess = await _db.PushSubscriptions
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id)
            .Skip(MaxPushSubscriptionsPerUser)
            .Select(s => s.Id)
            .ToListAsync();
        if (excess.Count > 0)
            await _db.PushSubscriptions.Where(s => excess.Contains(s.Id)).ExecuteDeleteAsync();
    }

    /// <summary>Deletes the user's subscription with this endpoint; another account's subscription is left alone. Missing is a no-op.</summary>
    public Task DeletePushSubscriptionAsync(Guid userId, string endpoint)
        => _db.PushSubscriptions.Where(s => s.UserId == userId && s.Endpoint == endpoint).ExecuteDeleteAsync();

    /// <summary>Bot only (reminder delivery): the user's push subscriptions, untracked.</summary>
    public Task<List<PushSubscription>> GetPushSubscriptionsAsync(Guid userId, CancellationToken cancellationToken = default)
        => _db.PushSubscriptions.AsNoTracking().Where(s => s.UserId == userId).OrderBy(s => s.Id).ToListAsync(cancellationToken);

    /// <summary>Bot only: deletes the subscription with this endpoint whoever owns it, after the push service reported it gone (404/410).</summary>
    public Task DeletePushSubscriptionByEndpointAsync(string endpoint, CancellationToken cancellationToken = default)
        => _db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ExecuteDeleteAsync(cancellationToken);
}
