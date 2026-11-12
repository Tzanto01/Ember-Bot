using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ember.Bot.Jobs;
using Ember.Core.Models;
using Ember.Core.Services;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using WebPushSubscription = Lib.Net.Http.WebPush.PushSubscription;

namespace Ember.Bot.Services;

/// <summary>
/// Sends reminders as Web Push notifications (VAPID, aes128gcm) to the user's push subscriptions in
/// <see cref="Reminder.PushSubscriptionIds"/>. The notification names no habit, since it can show on a lock screen; its tag
/// (<see cref="HabitTag"/>, <see cref="RoutineTag"/>) lets a later reminder or the clear push (<see cref="SendClearAsync"/>) replace it.
/// A subscription the push service reports as gone (404/410) is deleted. Delivered when at least one subscription accepted the
/// message; a delivered reminder is remembered (<see cref="HabitService.AddPushReminderAsync"/>) until its item is done or it expires.
/// A single-habit reminder also carries a "Done ✅" action with a one-time token (<see cref="HabitService.CreateReminderActionTokenAsync"/>)
/// that expires with the reminder (<see cref="ReminderDispatchJob.IsExpired"/>), sent only to subscriptions registered by a
/// sign-in session that is still live; other subscriptions and routine reminders get the plain payload.
/// </summary>
public sealed class WebPushReminderChannel : IReminderChannel
{
    /// <summary>Name of the <see cref="IHttpClientFactory"/> client used to reach push services.</summary>
    public const string HttpClientName = "web-push";

    /// <summary>How long (seconds) a push service keeps an undelivered reminder; a later one is pointless.</summary>
    public const int TimeToLiveSeconds = 12 * 60 * 60;

    private static readonly JsonSerializerOptions PayloadJson = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    /// <summary>The Angular service worker notification payload.</summary>
    public static readonly string Payload = BuildPayload(FirstBody);

    /// <summary>The payload of a second reminder: the same notification with its own body.</summary>
    public static readonly string SecondPayload = BuildPayload(SecondBody);

    private const string FirstBody = "A gentle nudge from Ember";
    private const string SecondBody = "One more nudge, in case the first one got buried.";

    /// <summary>The body of the notification the clear push shows (and the service worker closes again).</summary>
    public const string LoggedBody = "Logged. Nice work. ✅";

    /// <summary>The notification tag of a habit's reminders.</summary>
    public static string HabitTag(int habitId) => $"habit-{habitId}";

    /// <summary>The notification tag of a routine's reminders.</summary>
    public static string RoutineTag(int routineId) => $"routine-{routineId}";

    /// <summary>
    /// The clear payload for <paramref name="tag"/>: a v1.14 service worker closes the notifications with that tag; an older one
    /// shows the "Logged" notification.
    /// </summary>
    public static string ClearPayload(string tag) => JsonSerializer.Serialize(new
    {
        clear = new { tag },
        notification = new
        {
            title = "Ember",
            body = LoggedBody,
            data = new { onActionClick = new { @default = new { operation = "navigateLastFocusedOrOpen", url = "/today" } } },
        },
    }, PayloadJson);

    /// <summary>
    /// The notification payload with <paramref name="body"/>, plus the "Done" action when <paramref name="doneToken"/> is set and the
    /// <paramref name="tag"/> when set.
    /// </summary>
    internal static string BuildPayload(string body, string? doneToken = null, string? tag = null) => JsonSerializer.Serialize(new
    {
        notification = new
        {
            title = "Ember",
            body,
            tag,
            actions = doneToken is null ? null : new[] { new { action = "done", title = "Done ✅" } },
            data = new
            {
                onActionClick = new { @default = new { operation = "navigateLastFocusedOrOpen", url = "/today" } },
                doneToken,
            },
        },
    }, PayloadJson);

    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _httpClients;
    private readonly VapidAuthentication _vapid;
    private readonly ILogger<WebPushReminderChannel> _logger;

    public WebPushReminderChannel(IServiceScopeFactory scopes, IHttpClientFactory httpClients, VapidAuthentication vapid,
        ILogger<WebPushReminderChannel> logger)
    {
        _scopes      = scopes;
        _httpClients = httpClients;
        _vapid       = vapid;
        _logger      = logger;
    }

    /// <summary>Builds the VAPID authentication from <c>WebPush:PublicKey</c>, <c>WebPush:PrivateKey</c> and <c>WebPush:Subject</c>.</summary>
    /// <exception cref="InvalidOperationException">A key or the subject is missing or invalid.</exception>
    public static VapidAuthentication CreateVapidAuthentication(IConfiguration config)
    {
        try
        {
            return new VapidAuthentication(config["WebPush:PublicKey"], config["WebPush:PrivateKey"])
            {
                Subject = config["WebPush:Subject"],
            };
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or System.Security.Cryptography.CryptographicException)
        {
            throw new InvalidOperationException(InvalidConfigMessage, ex);
        }
    }

    private const string InvalidConfigMessage =
        "Invalid web push configuration: set all or none of WebPush:PublicKey, WebPush:PrivateKey and WebPush:Subject " +
        "(base64url VAPID keys; subject a mailto: or https: URL).";

    /// <summary>True when the VAPID public key, private key and subject are all configured, false when none is.</summary>
    /// <exception cref="InvalidOperationException">Only some of them are configured.</exception>
    public static bool IsConfigured(IConfiguration config)
    {
        var set = new[] { "WebPush:PublicKey", "WebPush:PrivateKey", "WebPush:Subject" }
            .Count(key => !string.IsNullOrWhiteSpace(config[key]));
        return set switch
        {
            0 => false,
            3 => true,
            _ => throw new InvalidOperationException(InvalidConfigMessage),
        };
    }

    public ReminderChannels Channel => ReminderChannels.WebPush;

    public async Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default)
    {
        List<Core.Models.PushSubscription> subscriptions;
        HashSet<Guid> liveSessions;
        var body = reminder.Second ? SecondBody : FirstBody;
        string? donePayload = null;
        var tag = reminder.PendingHabits is null ? HabitTag(reminder.HabitId) : RoutineTag(reminder.HabitId);
        var allowed = reminder.PushSubscriptionIds ?? [];
        using (var scope = _scopes.CreateScope())
        {
            var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
            subscriptions = (await habits.GetPushSubscriptionsAsync(reminder.UserId, cancellationToken))
                .Where(s => allowed.Contains(s.Id)).ToList();
            if (subscriptions.Count == 0) return DeliveryOutcome.UserNotFound;

            liveSessions = await habits.GetLiveSessionIdsAsync(reminder.UserId, cancellationToken);
            if (reminder.PendingHabits is null && subscriptions.Any(s => s.SessionId is { } id && liveSessions.Contains(id)))
                donePayload = BuildPayload(body, await habits.CreateReminderActionTokenAsync(reminder.UserId, reminder.HabitId, reminder.Day,
                    reminder.Day.AddDays(1).ToDateTime(new TimeOnly(MissedDayReflectionJob.LocalSendHour, 0)), cancellationToken), tag);
        }
        var plainPayload = BuildPayload(body, tag: tag);

        var delivered = await SendAsync(reminder.UserId, subscriptions,
            s => donePayload is not null && s.SessionId is { } sessionId && liveSessions.Contains(sessionId) ? donePayload : plainPayload,
            cancellationToken);
        if (!delivered) return DeliveryOutcome.Undeliverable;

        try
        {
            using var scope = _scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<HabitService>().AddPushReminderAsync(reminder.UserId,
                reminder.PendingHabits is null ? reminder.HabitId : null, reminder.PendingHabits is null ? null : reminder.HabitId,
                reminder.Day, cancellationToken);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(ex, "Could not remember the web push reminder for {Tag} of user {UserId}.", tag, reminder.UserId);
        }
        return DeliveryOutcome.Delivered;
    }

    /// <summary>Sends the clear payload (<see cref="ClearPayload"/>) for <paramref name="tag"/> to the user's push subscriptions in <paramref name="subscriptionIds"/>.</summary>
    public async Task SendClearAsync(Guid userId, IReadOnlyCollection<int> subscriptionIds, string tag, CancellationToken cancellationToken = default)
    {
        List<Core.Models.PushSubscription> subscriptions;
        using (var scope = _scopes.CreateScope())
            subscriptions = (await scope.ServiceProvider.GetRequiredService<HabitService>().GetPushSubscriptionsAsync(userId, cancellationToken))
                .Where(s => subscriptionIds.Contains(s.Id)).ToList();
        var payload = ClearPayload(tag);
        await SendAsync(userId, subscriptions, _ => payload, cancellationToken);
    }

    /// <summary>Pushes each subscription its payload; deletes ones the push service reports gone. True when at least one accepted it.</summary>
    private async Task<bool> SendAsync(Guid userId, List<Core.Models.PushSubscription> subscriptions,
        Func<Core.Models.PushSubscription, string> payloadFor, CancellationToken cancellationToken)
    {
        var client = new PushServiceClient(_httpClients.CreateClient(HttpClientName))
        {
            DefaultAuthentication = _vapid,
            AutoRetryAfter = false,
        };

        var delivered = false;
        foreach (var subscription in subscriptions)
        {
            var target = new WebPushSubscription { Endpoint = subscription.Endpoint, Keys = new Dictionary<string, string>() };
            target.SetKey(PushEncryptionKeyName.P256DH, subscription.P256dh);
            target.SetKey(PushEncryptionKeyName.Auth, subscription.Auth);

            var payload = payloadFor(subscription);
            try
            {
                await client.RequestPushMessageDeliveryAsync(target, new PushMessage(payload) { TimeToLive = TimeToLiveSeconds },
                    cancellationToken);
                delivered = true;
            }
            catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<HabitService>()
                        .DeletePushSubscriptionByEndpointAsync(subscription.Endpoint, cancellationToken);
                    _logger.LogInformation("Removed an expired push subscription {SubscriptionId} of user {UserId}.",
                        subscription.Id, userId);
                }
                catch (Exception deleteEx) when (!cancellationToken.IsCancellationRequested)
                {
                    _logger.LogWarning(deleteEx, "Could not remove the expired push subscription {SubscriptionId} of user {UserId}.",
                        subscription.Id, userId);
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Web push to subscription {SubscriptionId} of user {UserId} failed.",
                    subscription.Id, userId);
            }
        }

        return delivered;
    }
}
