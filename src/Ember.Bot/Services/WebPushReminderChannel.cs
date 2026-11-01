using System.Net;
using System.Text.Json;
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
/// </summary>
public sealed class WebPushReminderChannel : IReminderChannel
{
    /// <summary>Name of the <see cref="IHttpClientFactory"/> client used to reach push services.</summary>
    public const string HttpClientName = "web-push";

    /// <summary>How long (seconds) a push service keeps an undelivered reminder; a later one is pointless.</summary>
    public const int TimeToLiveSeconds = 12 * 60 * 60;

    /// <summary>The Angular service worker notification payload.</summary>
    public static readonly string Payload = JsonSerializer.Serialize(new
    {
        notification = new
        {
            title = "Ember",
            body = "A gentle nudge from Ember",
            data = new { onActionClick = new { @default = new { operation = "navigateLastFocusedOrOpen", url = "/today" } } },
        },
    });

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
            throw new InvalidOperationException(
                "Invalid web push configuration: check WebPush:PublicKey, WebPush:PrivateKey and WebPush:Subject " +
                "(base64url VAPID keys; subject a mailto: or https: URL).", ex);
        }
    }

    /// <summary>Whether the VAPID public key, private key and subject are all configured.</summary>
    public static bool IsConfigured(IConfiguration config)
        => !string.IsNullOrWhiteSpace(config["WebPush:PublicKey"])
            && !string.IsNullOrWhiteSpace(config["WebPush:PrivateKey"])
            && !string.IsNullOrWhiteSpace(config["WebPush:Subject"]);

    public ReminderChannels Channel => ReminderChannels.WebPush;

    public async Task<DeliveryOutcome> SendAsync(Reminder reminder, CancellationToken cancellationToken = default)
    {
        List<Core.Models.PushSubscription> subscriptions;
        using (var scope = _scopes.CreateScope())
        {
            subscriptions = await scope.ServiceProvider.GetRequiredService<HabitService>()
                .GetPushSubscriptionsAsync(reminder.UserId, cancellationToken);
        }
        if (subscriptions.Count == 0) return DeliveryOutcome.UserNotFound;

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
                await client.RequestPushMessageDeliveryAsync(target, new PushMessage(Payload) { TimeToLive = TimeToLiveSeconds },
                    cancellationToken);
                delivered = true;
            }
            catch (PushServiceClientException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                using var scope = _scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<HabitService>()
                    .DeletePushSubscriptionByEndpointAsync(subscription.Endpoint, cancellationToken);
                _logger.LogInformation("Removed an expired push subscription {SubscriptionId} of user {UserId}.",
                    subscription.Id, reminder.UserId);
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
