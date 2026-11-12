using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Ember.Core.Services;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>Limits from <c>Ember:RateLimits</c>.</summary>
internal sealed class RateLimitSettings
{
    public int AuthPerIpPerMinute { get; set; } = 30;
    public int AuthOtherPerIpPerMinute { get; set; } = 300;
    public int MailPerEmailPerHour { get; set; } = 5;
    public int MailPerEmailAnyClientPerHour { get; set; } = 20;
    public int MailPerIpPerHour { get; set; } = 10;
    public int MailPerDay { get; set; } = 200;
    public int FeedbackPerHour { get; set; } = 5;
    public int FeedbackPerDay { get; set; } = 200;
}

/// <summary>
/// Per client IP on the credential endpoints of <c>/api/auth</c> (the strict <see cref="AuthPolicy"/> policy) and on every
/// other <c>/api/auth</c> request (the loose <see cref="AuthOtherPolicy"/> policy, and the same limit as a global limiter on
/// the Discord OAuth callback, which the authentication handler answers before any endpoint runs), and on the mail-sending
/// endpoints per endpoint, normalized email and client IP, per email, per client IP and in total per day, and <c>POST /api/feedback</c> per user (with a daily picture byte budget), or per client IP and in total per
/// day for anonymous senders (the singleton <see cref="PartitionedRateLimiter{TResource}"/> of <see cref="string"/>, keyed by <see cref="MailKeys"/> and
/// <see cref="FeedbackKeys"/>, which never share a partition).
/// </summary>
internal static class RateLimits
{
    public const string AuthPolicy = "auth";
    public const string AuthOtherPolicy = "auth-other";
    private static readonly TimeSpan AuthWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan MailWindow = TimeSpan.FromHours(1);
    private static readonly TimeSpan MailDayWindow = TimeSpan.FromDays(1);
    private const string MailIpPrefix = "ip:";
    private const string MailEmailPrefix = "email:";
    private const string MailDayKey = "day";
    private const string FeedbackUserPrefix = "fb-user:";
    private const string FeedbackIpPrefix = "fb-ip:";
    private const string FeedbackDayKey = "fb-day";
    private const string FeedbackBytesPrefix = "fb-bytes:";
    private const string FeedbackBigBodyPrefix = "fb-big:";

    public static IServiceCollection AddEmberRateLimits(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RateLimitSettings>(configuration.GetSection("Ember:RateLimits"));
        services.AddSingleton(sp =>
        {
            var settings = sp.GetRequiredService<IOptions<RateLimitSettings>>().Value;
            return PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(key, _ => key switch
            {
                FeedbackDayKey => new FixedWindowRateLimiterOptions { PermitLimit = settings.FeedbackPerDay, Window = MailDayWindow },
                _ when key.StartsWith(FeedbackBytesPrefix, StringComparison.Ordinal)
                    => new FixedWindowRateLimiterOptions { PermitLimit = (int)HabitService.MaxFeedbackImageBytesPerUserPerDay, Window = MailDayWindow },
                _ when key.StartsWith(FeedbackUserPrefix, StringComparison.Ordinal) || key.StartsWith(FeedbackIpPrefix, StringComparison.Ordinal)
                    || key.StartsWith(FeedbackBigBodyPrefix, StringComparison.Ordinal)
                    => new FixedWindowRateLimiterOptions { PermitLimit = settings.FeedbackPerHour, Window = MailWindow },
                MailDayKey => new FixedWindowRateLimiterOptions { PermitLimit = settings.MailPerDay, Window = MailDayWindow },
                _ when key.StartsWith(MailIpPrefix, StringComparison.Ordinal)
                    => new FixedWindowRateLimiterOptions { PermitLimit = settings.MailPerIpPerHour, Window = MailWindow },
                _ when key.StartsWith(MailEmailPrefix, StringComparison.Ordinal)
                    => new FixedWindowRateLimiterOptions { PermitLimit = settings.MailPerEmailAnyClientPerHour, Window = MailWindow },
                _ => new FixedWindowRateLimiterOptions { PermitLimit = settings.MailPerEmailPerHour, Window = MailWindow },
            }));
        });
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(AuthPolicy, http => PerIp(http, http.RequestServices.GetRequiredService<IOptions<RateLimitSettings>>().Value.AuthPerIpPerMinute));
            options.AddPolicy(AuthOtherPolicy, http => PerIp(http, http.RequestServices.GetRequiredService<IOptions<RateLimitSettings>>().Value.AuthOtherPerIpPerMinute));
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
                http.Request.Path.Equals(DiscordEndpoints.CallbackPath, StringComparison.OrdinalIgnoreCase)
                    ? PerIp(http, http.RequestServices.GetRequiredService<IOptions<RateLimitSettings>>().Value.AuthOtherPerIpPerMinute)
                    : RateLimitPartition.GetNoLimiter("unlimited"));
            options.OnRejected = (context, _) => new ValueTask(Reject(context.HttpContext, context.Lease, AuthWindow).ExecuteAsync(context.HttpContext));
        });
        return services;
    }

    private static RateLimitPartition<string> PerIp(HttpContext http, int limit)
        => RateLimitPartition.GetFixedWindowLimiter(ClientKey(http.Connection.RemoteIpAddress),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = limit, Window = AuthWindow });

    /// <summary>
    /// The mail limiter keys for one mail, in the order to take them: the client IP first (the only partition an unthrottled
    /// caller can create), then the narrower email keys, and the daily total last, so a request rejected by a narrower limit
    /// doesn't use up the shared allowance. Emails go into keys as a fixed-size hash, so key memory doesn't grow with input.
    /// </summary>
    internal static string[] MailKeys(string endpoint, string normalizedEmail, IPAddress? address)
    {
        var client = ClientKey(address);
        var email = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedEmail)));
        return [MailIpPrefix + client, $"{endpoint}:{email}:{client}", MailEmailPrefix + email, MailDayKey];
    }

    /// <summary>
    /// The feedback limiter keys for one feedback, in the order to take them: a signed-in sender only by user, so anonymous
    /// traffic can't use up their allowance; an anonymous sender by client IP first and the anonymous daily total last, so a
    /// sender over their limit doesn't use up the shared allowance.
    /// </summary>
    internal static string[] FeedbackKeys(Guid? userId, IPAddress? address)
        => userId is { } id ? [FeedbackUserPrefix + id.ToString("N")] : [FeedbackIpPrefix + ClientKey(address), FeedbackDayKey];

    /// <summary>
    /// The limiter key of a signed-in user's picture bytes, one permit per decoded byte, at most
    /// <see cref="HabitService.MaxFeedbackImageBytesPerUserPerDay"/> per day; taken after <see cref="FeedbackKeys"/>.
    /// </summary>
    internal static string FeedbackBytesKey(Guid userId) => FeedbackBytesPrefix + userId.ToString("N");

    /// <summary>
    /// The limiter key of a signed-in user's feedback requests over 64 KiB, taken before the body is read, at most
    /// <see cref="RateLimitSettings.FeedbackPerHour"/> per hour, valid or not.
    /// </summary>
    internal static string FeedbackBigBodyKey(Guid userId) => FeedbackBigBodyPrefix + userId.ToString("N");

    /// <summary>The per-IP partition: an IPv4 address (also when IPv4-mapped), or the /64 network of an IPv6 address.</summary>
    internal static string ClientKey(IPAddress? address)
    {
        if (address is null) return "";
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return address.ToString();

        var bytes = address.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new IPAddress(bytes) + "/64";
    }

    /// <summary>Sets <c>Retry-After</c> (from the lease, else the whole <paramref name="window"/>) and returns the 429 problem.</summary>
    public static IResult Reject(HttpContext http, RateLimitLease lease, TimeSpan window)
    {
        var retryAfter = lease.TryGetMetadata(MetadataName.RetryAfter, out var fromLease) ? fromLease : window;
        http.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        return Problems.RateLimited();
    }
}
