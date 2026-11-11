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
/// Sends reminders as Web Push notifications (VAPID, aes128gcm) to every push subscription of the user.
/// The notification names no habit, since it can show on a lock screen. A subscription the push service reports
/// as gone (404/410) is deleted. Delivered when at least one subscription accepted the message.
/// A single-habit reminder also carries a "Done ✅" action with a one-time token (<see cref="HabitService.CreateReminderActionTokenAsync"/>)
/// that expires with the reminder (<see cref="ReminderDispatchJob.IsExpired"/>); a routine reminder doesn't.
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

    /// <summary>The notification payload with <paramref name="body"/>, plus the "Done" action when <paramref name="doneToken"/> is set.</summary>
    internal static string BuildPayload(string body, string? doneToken = null) => JsonSerializer.Serialize(new
    {
        notification = new
        {
            title = "Ember",
            body,
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
        string payload;
        using (var scope = _scopes.CreateScope())
        {
            var habits = scope.ServiceProvider.GetRequiredService<HabitService>();
            subscriptions = await habits.GetPushSubscriptionsAsync(reminder.UserId, cancellationToken);
            if (subscriptions.Count == 0) return DeliveryOutcome.UserNotFound;

            var doneToken = reminder.PendingHabits is null
                ? await habits.CreateReminderActionTokenAsync(reminder.UserId, reminder.HabitId, reminder.Day,
                    reminder.Day.AddDays(1).ToDateTime(new TimeOnly(MissedDayReflectionJob.LocalSendHour, 0)), cancellationToken)
                : null;
            payload = BuildPayload(reminder.Second ? SecondBody : FirstBody, doneToken);
        }

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
                        subscription.Id, reminder.UserId);
                }
                catch (Exception deleteEx) when (!cancellationToken.IsCancellationRequested)
                {
                    _logger.LogWarning(deleteEx, "Could not remove the expired push subscription {SubscriptionId} of user {UserId}.",
                        subscription.Id, reminder.UserId);
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Web push to subscription {SubscriptionId} of user {UserId} failed.",
                    subscription.Id, reminder.UserId);
            }
        }

        return delivered ? DeliveryOutcome.Delivered : DeliveryOutcome.Undeliverable;
    }
}
