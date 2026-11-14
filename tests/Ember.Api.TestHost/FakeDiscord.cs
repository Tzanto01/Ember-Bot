using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using AspNet.Security.OAuth.Discord;
using Microsoft.AspNetCore.WebUtilities;

namespace Ember.Api.TestHost;

/// <summary>
/// Discord's token and user-info endpoints, answered in-process as the Discord OAuth handler's backchannel.
/// Each pending authorization is kept under a key that the fake authorize endpoint passes on as the OAuth <c>code</c>; the token
/// exchange takes the Discord ID set for that code (once). Without one the user-info call answers 401, so the handler fails like
/// on a real remote error. Thread-safe.
/// </summary>
public sealed class FakeDiscord : HttpMessageHandler
{
    /// <summary>The code used when the authorization carries no key.</summary>
    public const string DefaultKey = "fake";

    private const string TokenPrefix = "fake-discord-token-";

    private readonly ConcurrentDictionary<string, string?> _pending = new(StringComparer.Ordinal);

    /// <summary>The next authorization without a key returns this Discord user ID.</summary>
    public void SetNext(ulong discordId) => SetNext(DefaultKey, discordId);

    /// <summary>The next authorization under <paramref name="key"/> returns this Discord user ID.</summary>
    public void SetNext(string key, ulong discordId)
        => _pending[key] = discordId.ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The next authorization under <paramref name="key"/> ends with <c>error=access_denied</c>, as if the user cancelled on Discord.</summary>
    public void DenyNext(string key) => _pending[key] = null;

    /// <summary>Whether the authorization under <paramref name="key"/> is denied; used by the fake authorize endpoint. Resets the denial.</summary>
    public bool TakeDeny(string key) => _pending.TryRemove(new KeyValuePair<string, string?>(key, null));

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Post && Is(request, DiscordAuthenticationDefaults.TokenEndpoint))
        {
            var form = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            var code = QueryHelpers.ParseQuery(form).TryGetValue("code", out var values) ? values.ToString() : DefaultKey;
            _pending.TryRemove(code, out var id);
            return Json(new { access_token = TokenPrefix + id, token_type = "Bearer", expires_in = 604800, scope = "identify" });
        }

        if (request.Method == HttpMethod.Get && Is(request, DiscordAuthenticationDefaults.UserInformationEndpoint))
        {
            return request.Headers.Authorization?.Parameter is { } token && token.StartsWith(TokenPrefix, StringComparison.Ordinal)
                && token[TokenPrefix.Length..] is { Length: > 0 } discordId
                    ? Json(new { id = discordId, username = $"tester{discordId}", discriminator = "0", global_name = "Test user" })
                    : new HttpResponseMessage(HttpStatusCode.Unauthorized);
        }

        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    private static bool Is(HttpRequestMessage request, string endpoint)
        => request.RequestUri is { } uri
           && Uri.Compare(uri, new Uri(endpoint), UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

    private static HttpResponseMessage Json(object body)
        => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };
}
