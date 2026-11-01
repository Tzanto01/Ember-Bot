using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>Limits from <c>Ember:RateLimits</c>.</summary>
internal sealed class RateLimitSettings
{
    public int AuthPerIpPerMinute { get; set; } = 30;
    public int AuthOtherPerIpPerMinute { get; set; } = 300;
    public int MailPerEmailPerHour { get; set; } = 5;
}

/// <summary>
/// Per client IP on the credential endpoints of <c>/api/auth</c> (the strict <see cref="AuthPolicy"/> policy) and on every
/// other <c>/api/auth</c> request (the loose <see cref="AuthOtherPolicy"/> policy, and the same limit as a global limiter on
/// the Discord OAuth callback, which the authentication handler answers before any endpoint runs), and per normalized email
/// address on the mail-sending endpoints (the singleton <see cref="PartitionedRateLimiter{TResource}"/> of <see cref="string"/>).
/// </summary>
internal static class RateLimits
{
    public const string AuthPolicy = "auth";
    public const string AuthOtherPolicy = "auth-other";
    private static readonly TimeSpan AuthWindow = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan MailWindow = TimeSpan.FromHours(1);

    public static IServiceCollection AddEmberRateLimits(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RateLimitSettings>(configuration.GetSection("Ember:RateLimits"));
        services.AddSingleton(sp =>
        {
            var limit = sp.GetRequiredService<IOptions<RateLimitSettings>>().Value.MailPerEmailPerHour;
            return PartitionedRateLimiter.Create<string, string>(email => RateLimitPartition.GetFixedWindowLimiter(email,
                _ => new FixedWindowRateLimiterOptions { PermitLimit = limit, Window = MailWindow }));
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
