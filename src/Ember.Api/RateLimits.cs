using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>Limits from <c>Ember:RateLimits</c>.</summary>
internal sealed class RateLimitSettings
{
    public int AuthPerIpPerMinute { get; set; } = 30;
    public int MailPerEmailPerHour { get; set; } = 5;
}

/// <summary>
/// Per client IP on <c>/api/auth</c> (the <see cref="AuthPolicy"/> policy), and per normalized email address on the
/// mail-sending endpoints (the singleton <see cref="PartitionedRateLimiter{TResource}"/> of <see cref="string"/>).
/// </summary>
internal static class RateLimits
{
    public const string AuthPolicy = "auth";
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
            options.AddPolicy(AuthPolicy, http =>
            {
                var limit = http.RequestServices.GetRequiredService<IOptions<RateLimitSettings>>().Value.AuthPerIpPerMinute;
                return RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "",
                    _ => new FixedWindowRateLimiterOptions { PermitLimit = limit, Window = AuthWindow });
            });
            options.OnRejected = (context, _) => new ValueTask(Reject(context.HttpContext, context.Lease, AuthWindow).ExecuteAsync(context.HttpContext));
        });
        return services;
    }

    /// <summary>Sets <c>Retry-After</c> (from the lease, else the whole <paramref name="window"/>) and returns the 429 problem.</summary>
    public static IResult Reject(HttpContext http, RateLimitLease lease, TimeSpan window)
    {
        var retryAfter = lease.TryGetMetadata(MetadataName.RetryAfter, out var fromLease) ? fromLease : window;
        http.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        return Problems.RateLimited();
    }
}
