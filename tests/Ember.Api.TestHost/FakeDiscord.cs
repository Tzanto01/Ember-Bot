using System.Net;
using System.Net.Http.Json;
using AspNet.Security.OAuth.Discord;

namespace Ember.Api.TestHost;

/// <summary>
/// Discord's token and user-info endpoints, answered in-process as the Discord OAuth handler's backchannel.
/// The token exchange takes the Discord ID set with <see cref="SetNext"/> (once); without one the user-info call
/// answers 401, so the handler fails like on a real remote error. Thread-safe.
/// </summary>
public sealed class FakeDiscord : HttpMessageHandler
{
    private const string TokenPrefix = "fake-discord-token-";

    private readonly Lock _lock = new();
    private string? _nextId;
    private bool _denyNext;

    /// <summary>The next authorization returns this Discord user ID.</summary>
    public void SetNext(ulong discordId)
    {
        lock (_lock)
        {
            _nextId = discordId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            _denyNext = false;
        }
    }

    /// <summary>The next authorization ends with <c>error=access_denied</c>, as if the user cancelled on Discord.</summary>
    public void DenyNext()
    {
        lock (_lock)
        {
            _nextId = null;
            _denyNext = true;
        }
    }

    /// <summary>Whether this authorization is denied; used by the fake authorize endpoint. Resets the flag.</summary>
    public bool TakeDeny()
    {
        lock (_lock)
        {
            var deny = _denyNext;
            _denyNext = false;
            return deny;
        }
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Method == HttpMethod.Post && Is(request, DiscordAuthenticationDefaults.TokenEndpoint))
        {
            string? id;
            lock (_lock)
            {
                id = _nextId;
                _nextId = null;
            }
            return Json(new { access_token = TokenPrefix + id, token_type = "Bearer", expires_in = 604800, scope = "identify" });
        }

        if (request.Method == HttpMethod.Get && Is(request, DiscordAuthenticationDefaults.UserInformationEndpoint))
        {
            return request.Headers.Authorization?.Parameter is { } token && token.StartsWith(TokenPrefix, StringComparison.Ordinal)
                && token[TokenPrefix.Length..] is { Length: > 0 } discordId
                    ? Json(new { id = discordId, username = $"tester{discordId}", discriminator = "0", global_name = "Test user" })
                    : Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
    }

    private static bool Is(HttpRequestMessage request, string endpoint)
        => request.RequestUri is { } uri
           && Uri.Compare(uri, new Uri(endpoint), UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

    private static Task<HttpResponseMessage> Json(object body)
        => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body) });
}
