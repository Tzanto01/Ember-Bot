using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Net.Http.Headers;

namespace Ember.Api;

/// <summary>
/// CORS by request origin: the web origin (<see cref="ApiApp.WebOrigin"/>) with credentials and any header, the native app
/// origins (<see cref="ApiApp.NativeOrigins"/>) with only <c>Authorization</c>, <c>Content-Type</c> and the sign-up key header and no credentials,
/// and no policy (no CORS headers) for any other origin. The web origin wins when it is also a native one.
/// </summary>
internal sealed class EmberCorsPolicyProvider(IConfiguration configuration) : ICorsPolicyProvider
{
    private readonly CorsPolicy? _web = ApiApp.WebOrigin(configuration) is { } origin
        ? new CorsPolicyBuilder(origin).AllowCredentials().AllowAnyHeader().AllowAnyMethod().Build()
        : null;

    private readonly CorsPolicy _native = new CorsPolicyBuilder(ApiApp.NativeOrigins(configuration))
        .WithHeaders(HeaderNames.Authorization, HeaderNames.ContentType, Email.EmberEmailSender.SignupKeyHeader)
        .WithExposedHeaders(HeaderNames.ContentDisposition, HeaderNames.RetryAfter).AllowAnyMethod().Build();

    public Task<CorsPolicy?> GetPolicyAsync(HttpContext context, string? policyName)
    {
        var origin = context.Request.Headers.Origin.ToString();
        var policy = _web?.IsOriginAllowed(origin) == true ? _web : _native.IsOriginAllowed(origin) ? _native : null;
        return Task.FromResult(policy);
    }
}
