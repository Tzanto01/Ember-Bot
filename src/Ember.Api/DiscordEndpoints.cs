using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using AspNet.Security.OAuth.Discord;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>Discord sign-in, linking and unlinking. Every outcome ends in a redirect to a web app page.</summary>
internal static class DiscordEndpoints
{
    public const string CallbackPath = "/api/auth/discord/callback";

    private const string FlowKey = "ember.flow";
    private const string LoginFlow = "login";
    private const string LinkFlow = "link";
    private const string NativeFlow = "native";
    private const string ChallengeKey = "ember.challenge";

    private const string LoginError = "/login?discord=error";
    private const string LinkError = "/settings?discord=error";
    private const string Linked = "/settings?discord=linked";
    private const string LinkConflict = "/settings?discord=conflict";
    private const string LinkPasswordNeeded = "/settings?discord=password";
    private const string MergePage = "/link/merge";
    private const string TwoFactorStep = "/login?step=2fa";

    private const string LinkPath = "/api/auth/discord/link";
    private const string LinkGrantCookie = "__Secure-ember.discord-link";
    private const string LinkGrantDevelopmentCookie = "ember.discord-link";
    private static readonly TimeSpan LinkGrantLifetime = TimeSpan.FromMinutes(5);

    /// <summary>The Android app's custom scheme redirect (its application ID); the native flow ends here, never elsewhere.</summary>
    private const string NativeRedirect = "app.ember.habits://auth/discord";
    private const string NativeError = NativeRedirect + "?error=discord";
    private static readonly TimeSpan NativeCodeLifetime = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan NativeTwoFactorLifetime = TimeSpan.FromMinutes(5);

    public sealed record TwoFactorRequest(string? Code, string? RecoveryCode);

    public sealed record LinkStartRequest(string? Password);

    public sealed record NativeTokenRequest(string? Code, string? Verifier, string? TwoFactorCode, string? TwoFactorRecoveryCode);

    /// <summary>
    /// The Discord OAuth handler under <see cref="DiscordLogin.Provider"/>: scope <c>identify</c>, signing into Identity's
    /// external cookie, with the redirect URI built from <c>Ember:WebOrigin</c>. Without <c>Discord:ClientId</c> and
    /// <c>Discord:ClientSecret</c> (Development only) the challenge goes to Discord with placeholder credentials.
    /// </summary>
    public static AuthenticationBuilder AddEmberDiscord(this AuthenticationBuilder authentication, IConfiguration config, IHostEnvironment environment)
        => authentication.AddOAuth<DiscordAuthenticationOptions, EmberDiscordHandler>(DiscordLogin.Provider, DiscordLogin.Provider, options =>
        {
            options.ClientId = config["Discord:ClientId"] is { Length: > 0 } clientId ? clientId : "unconfigured";
            options.ClientSecret = config["Discord:ClientSecret"] is { Length: > 0 } clientSecret ? clientSecret : "unconfigured";
            options.CallbackPath = CallbackPath;
            options.Scope.Clear();
            options.Scope.Add("identify");
            options.SignInScheme = IdentityConstants.ExternalScheme;
            options.SaveTokens = false;
            options.CorrelationCookie.SameSite = SameSiteMode.Lax;
            options.CorrelationCookie.SecurePolicy = environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
            options.Events.OnRemoteFailure = context =>
            {
                var flow = context.Properties?.Items.TryGetValue(FlowKey, out var value) == true ? value : null;
                context.Response.Redirect(flow switch { LinkFlow => LinkError, NativeFlow => NativeError, _ => LoginError });
                context.HandleResponse();
                return Task.CompletedTask;
            };
        });

    public static RouteGroupBuilder MapDiscord(this RouteGroupBuilder auth)
    {
        auth.MapGet("/discord/login", (string? returnUrl, string? client, string? challenge, SignInManager<User> signIn) =>
        {
            if (client != NativeFlow)
                return Results.Challenge(
                    Properties(signIn, LoginFlow, $"/api/auth/discord/login/complete?returnUrl={Uri.EscapeDataString(LocalOrToday(returnUrl))}"),
                    [DiscordLogin.Provider]);

            if (!IsChallenge(challenge)) return Results.Redirect(NativeError);
            var properties = Properties(signIn, NativeFlow, "/api/auth/discord/native/complete");
            properties.Items[ChallengeKey] = challenge;
            return Results.Challenge(properties, [DiscordLogin.Provider]);
        });

        auth.MapGet("/discord/native/complete", async (HttpContext http, SignInManager<User> signIn, UserManager<User> users,
            HabitService habits, IMemoryCache cache, TimeProvider time) =>
        {
            var info = await signIn.GetExternalLoginInfoAsync();
            await http.SignOutAsync(IdentityConstants.ExternalScheme);
            if (DiscordId(info, NativeFlow) is not { } discordId
                || !info!.AuthenticationProperties!.Items.TryGetValue(ChallengeKey, out var challenge) || !IsChallenge(challenge))
                return Results.Redirect(NativeError);

            var userId = await habits.ResolveOrCreateDiscordUserAsync(discordId);
            if (await users.FindByIdAsync(userId.ToString()) is null) return Results.Redirect(NativeError);

            var code = Base64Url(RandomNumberGenerator.GetBytes(32));
            cache.Set(NativeKey(code), new NativeGrant(userId, challenge, time.GetUtcNow() + NativeCodeLifetime), NativeCodeLifetime);
            return Results.Redirect($"{NativeRedirect}?code={code}");
        });

        auth.MapPost("/discord/native/token", async (NativeTokenRequest request, SignInManager<User> signIn, UserManager<User> users,
            IMemoryCache cache, TimeProvider time) =>
        {
            var key = request.Code is { Length: > 0 } code ? NativeKey(code) : null;
            if (key is null || !cache.TryGetValue(key, out NativeGrant? grant) || grant is null || !grant.TryTake()) return Failed();
            if (grant.ExpiresUtc <= time.GetUtcNow() || !VerifierMatches(request.Verifier, grant.Challenge))
            {
                cache.Remove(key);
                return Failed();
            }

            var user = await users.FindByIdAsync(grant.UserId.ToString());
            if (user is null)
            {
                cache.Remove(key);
                return Failed();
            }

            if (user.TwoFactorEnabled)
            {
                if (request.TwoFactorCode is not { Length: > 0 } && request.TwoFactorRecoveryCode is not { Length: > 0 })
                {
                    if (!grant.TwoFactorPending)
                    {
                        grant.TwoFactorPending = true;
                        grant.ExpiresUtc = time.GetUtcNow() + NativeTwoFactorLifetime;
                        cache.Set(key, grant, NativeTwoFactorLifetime);
                    }
                    grant.Release();
                    return TypedResults.Problem("RequiresTwoFactor", statusCode: StatusCodes.Status401Unauthorized);
                }

                if (!await SecondFactorPassedAsync(users, user, request.TwoFactorCode, request.TwoFactorRecoveryCode))
                {
                    grant.Release();
                    return Failed();
                }
            }

            cache.Remove(key);
            signIn.AuthenticationScheme = IdentityConstants.BearerScheme;
            await signIn.SignInAsync(user, isPersistent: false, authenticationMethod: DiscordLogin.Provider);
            return Results.Empty;
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        auth.MapGet("/discord/login/complete", async (string? returnUrl, HttpContext http, SignInManager<User> signIn,
            UserManager<User> users, HabitService habits) =>
        {
            var info = await signIn.GetExternalLoginInfoAsync();
            await http.SignOutAsync(IdentityConstants.ExternalScheme);
            if (DiscordId(info, LoginFlow) is not { } discordId) return Results.Redirect(LoginError);

            var userId = await habits.ResolveOrCreateDiscordUserAsync(discordId);
            var user = await users.FindByIdAsync(userId.ToString());
            if (user is null) return Results.Redirect(LoginError);

            if (user.TwoFactorEnabled)
            {
                await http.SignInAsync(IdentityConstants.TwoFactorUserIdScheme, new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.Name, user.Id.ToString()), new Claim(ClaimTypes.AuthenticationMethod, DiscordLogin.Provider)],
                    IdentityConstants.TwoFactorUserIdScheme)));
                return Results.Redirect(LocalOrToday(returnUrl) is var local && local == returnUrl
                    ? $"{TwoFactorStep}&returnUrl={Uri.EscapeDataString(local)}"
                    : TwoFactorStep);
            }

            await signIn.SignInAsync(user, isPersistent: true, authenticationMethod: DiscordLogin.Provider);
            return Results.Redirect(LocalOrToday(returnUrl));
        });

        auth.MapPost("/discord/2fa", async (TwoFactorRequest request, HttpContext http, SignInManager<User> signIn, UserManager<User> users) =>
        {
            var user = await signIn.GetTwoFactorAuthenticationUserAsync();
            if (user is null || !user.TwoFactorEnabled || !await SecondFactorPassedAsync(users, user, request.Code, request.RecoveryCode))
                return Failed();

            await http.SignOutAsync(IdentityConstants.TwoFactorUserIdScheme);
            await signIn.SignInAsync(user, isPersistent: true, authenticationMethod: DiscordLogin.Provider);
            return Results.NoContent();
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        auth.MapPost("/discord/link/start", async (LinkStartRequest request, HttpContext http, UserManager<User> users, SignInManager<User> signIn,
            IMemoryCache cache, TimeProvider time) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Problems.Unauthenticated();
            if (!await users.HasPasswordAsync(user)) return Problems.Conflict("This account has no password to check.");
            if (!(await signIn.CheckPasswordSignInAsync(user, request.Password ?? "", lockoutOnFailure: true)).Succeeded)
                return Problems.Validation("password", "The password is not correct.");

            var token = RandomNumberGenerator.GetHexString(64);
            var expires = time.GetUtcNow() + LinkGrantLifetime;
            cache.Set(GrantKey(token), new LinkGrant(user.Id, expires), LinkGrantLifetime);
            http.Response.Cookies.Append(GrantCookieName(http), token, GrantCookieOptions(http, LinkGrantLifetime));
            return Results.NoContent();
        }).RequireAuthorization().RequireRateLimiting(RateLimits.AuthPolicy);

        auth.MapGet("/discord/link", async (HttpContext http, SignInManager<User> signIn, UserManager<User> users, IMemoryCache cache, TimeProvider time) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Results.Redirect(LinkError);
            if (await users.HasPasswordAsync(user) && !ConsumeGrant(http, user, cache, time)) return Results.Redirect(LinkPasswordNeeded);
            return Results.Challenge(Properties(signIn, LinkFlow, "/api/auth/discord/link/complete", users.GetUserId(http.User)), [DiscordLogin.Provider]);
        }).RequireAuthorization();

        auth.MapGet("/discord/link/complete", async (HttpContext http, SignInManager<User> signIn, UserManager<User> users) =>
        {
            var user = await users.GetUserAsync(http.User);
            var info = user is null ? null : await signIn.GetExternalLoginInfoAsync(users.GetUserId(http.User));
            await http.SignOutAsync(IdentityConstants.ExternalScheme);
            if (user is null || DiscordId(info, LinkFlow) is not { } discordId) return Results.Redirect(LinkError);

            var key = DiscordLogin.Key(discordId);
            var existing = (await users.GetLoginsAsync(user)).FirstOrDefault(l => l.LoginProvider == DiscordLogin.Provider);
            if (existing is not null) return Results.Redirect(existing.ProviderKey == key ? Linked : LinkConflict);

            var owner = await users.FindByLoginAsync(DiscordLogin.Provider, key);
            if (owner is null)
            {
                try
                {
                    if (!(await users.AddLoginAsync(user, new UserLoginInfo(DiscordLogin.Provider, key, DiscordLogin.Provider))).Succeeded)
                        return Results.Redirect(LinkConflict);
                }
                catch (DbUpdateException)
                {
                    return Results.Redirect(LinkConflict);
                }
                await users.UpdateSecurityStampAsync(user);
                await signIn.RefreshSignInAsync(user);
                return Results.Redirect(Linked);
            }

            if (owner.PasswordHash is not null || owner.Email is not null || owner.TwoFactorEnabled) return Results.Redirect(LinkConflict);

            PendingMerge.Store(http, user, owner.Id, discordId);
            return Results.Redirect(MergePage);
        });

        return auth;
    }

    /// <summary><c>DELETE /api/me/discord</c>: only for accounts that can still sign in with a password and a confirmed email.</summary>
    public static RouteGroupBuilder MapDiscordUnlink(this RouteGroupBuilder api)
    {
        api.MapDelete("/me/discord", async (HttpContext http, UserManager<User> users, SignInManager<User> signIn) =>
        {
            var user = await users.GetUserAsync(http.User);
            if (user is null) return Problems.Unauthenticated();
            if (user.PasswordHash is null || !user.EmailConfirmed)
                return Problems.Conflict("Set a password and confirm your email before unlinking Discord.");

            var login = (await users.GetLoginsAsync(user)).FirstOrDefault(l => l.LoginProvider == DiscordLogin.Provider);
            if (login is null) return Results.NoContent();

            if (!(await users.RemoveLoginAsync(user, login.LoginProvider, login.ProviderKey)).Succeeded)
                return Problems.Conflict("Discord could not be unlinked.");
            await users.UpdateSecurityStampAsync(user);
            await signIn.RefreshSignInAsync(user);
            return Results.NoContent();
        });

        return api;
    }

    /// <summary>
    /// Takes the link grant from the request's cookie: true when it is unexpired and was issued to <paramref name="user"/>.
    /// The grant and its cookie are gone afterwards either way.
    /// </summary>
    private static bool ConsumeGrant(HttpContext http, User user, IMemoryCache cache, TimeProvider time)
    {
        var name = GrantCookieName(http);
        if (!http.Request.Cookies.TryGetValue(name, out var token) || string.IsNullOrEmpty(token)) return false;
        http.Response.Cookies.Delete(name, GrantCookieOptions(http, null));

        var key = GrantKey(token);
        if (!cache.TryGetValue(key, out LinkGrant? grant)) return false;
        cache.Remove(key);
        return grant is not null && grant.UserId == user.Id && grant.ExpiresUtc > time.GetUtcNow();
    }

    /// <summary>
    /// The authenticator <paramref name="code"/> or else the <paramref name="recoveryCode"/> of an account that isn't locked out.
    /// A failed recovery code counts towards lockout (a failed authenticator code does in <see cref="TwoFactorEndpoints.CheckCodeAsync"/>);
    /// a pass resets the count.
    /// </summary>
    private static async Task<bool> SecondFactorPassedAsync(UserManager<User> users, User user, string? code, string? recoveryCode)
    {
        if (await users.IsLockedOutAsync(user)) return false;

        var passed = code is { Length: > 0 }
            ? await TwoFactorEndpoints.CheckCodeAsync(users, user, code)
            : recoveryCode is { Length: > 0 } && (await users.RedeemTwoFactorRecoveryCodeAsync(user, recoveryCode)).Succeeded;
        if (!passed)
        {
            if (code is not { Length: > 0 }) await users.AccessFailedAsync(user);
            return false;
        }

        await users.ResetAccessFailedCountAsync(user);
        return true;
    }

    /// <summary>A PKCE S256 challenge: 43 base64url characters (a SHA-256 hash, unpadded).</summary>
    private static bool IsChallenge([NotNullWhen(true)] string? challenge)
        => challenge is { Length: 43 } && challenge.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    /// <summary>Whether the base64url SHA-256 of <paramref name="verifier"/> (43 to 128 RFC 7636 characters) is <paramref name="challenge"/>.</summary>
    private static bool VerifierMatches(string? verifier, string challenge)
        => verifier is { Length: >= 43 and <= 128 }
           && verifier.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '.' or '_' or '~')
           && CryptographicOperations.FixedTimeEquals(
               Encoding.ASCII.GetBytes(Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)))), Encoding.ASCII.GetBytes(challenge));

    private static string Base64Url(byte[] bytes) => Base64UrlTextEncoder.Encode(bytes);

    private static string NativeKey(string code) => $"discord-native-code:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)))}";

    /// <summary>
    /// A one-time code of the native Discord sign-in: <see cref="UserId"/> signed in with Discord, and the code's holder may exchange
    /// it with the PKCE verifier of <see cref="Challenge"/> until <see cref="ExpiresUtc"/>. One exchange runs at a time (<see cref="TryTake"/>).
    /// </summary>
    private sealed class NativeGrant(Guid userId, string challenge, DateTimeOffset expiresUtc)
    {
        private int taken;

        public Guid UserId { get; } = userId;
        public string Challenge { get; } = challenge;
        public DateTimeOffset ExpiresUtc { get; set; } = expiresUtc;
        public bool TwoFactorPending { get; set; }

        public bool TryTake() => Interlocked.Exchange(ref taken, 1) == 0;

        public void Release() => Volatile.Write(ref taken, 0);
    }

    private static string GrantKey(string token) => $"discord-link-grant:{token}";

    private static bool IsDevelopment(HttpContext http) => http.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment();

    private static string GrantCookieName(HttpContext http) => IsDevelopment(http) ? LinkGrantDevelopmentCookie : LinkGrantCookie;

    private static CookieOptions GrantCookieOptions(HttpContext http, TimeSpan? maxAge) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Secure = http.Request.IsHttps || !IsDevelopment(http),
        Path = LinkPath,
        MaxAge = maxAge,
        IsEssential = true,
    };

    /// <summary>A password check that lets <see cref="UserId"/> start one Discord link until <see cref="ExpiresUtc"/>.</summary>
    private sealed record LinkGrant(Guid UserId, DateTimeOffset ExpiresUtc);

    private static IResult Failed() => TypedResults.Problem("Failed", statusCode: StatusCodes.Status401Unauthorized);

    /// <summary>
    /// A local ASCII path (a single leading <c>/</c>, no <c>//</c>, <c>/\</c> or control characters, also after percent-decoding),
    /// else <c>/today</c>.
    /// </summary>
    internal static string LocalOrToday(string? returnUrl)
    {
        if (returnUrl is null || !returnUrl.All(char.IsAscii)) return "/today";

        var value = returnUrl;
        while (true)
        {
            if (value is not ['/', ..] || (value.Length > 1 && value[1] is '/' or '\\') || value.Any(char.IsControl)) return "/today";
            var decoded = Uri.UnescapeDataString(value);
            if (decoded == value) return returnUrl;
            value = decoded;
        }
    }

    private static AuthenticationProperties Properties(SignInManager<User> signIn, string flow, string redirectUrl, string? userId = null)
    {
        var properties = signIn.ConfigureExternalAuthenticationProperties(DiscordLogin.Provider, redirectUrl, userId);
        properties.Items[FlowKey] = flow;
        return properties;
    }

    private static ulong? DiscordId(ExternalLoginInfo? info, string flow)
        => info is not null
           && info.LoginProvider == DiscordLogin.Provider
           && info.AuthenticationProperties?.Items.TryGetValue(FlowKey, out var actualFlow) == true && actualFlow == flow
           && ulong.TryParse(info.ProviderKey, NumberStyles.None, CultureInfo.InvariantCulture, out var discordId)
            ? discordId
            : null;

    /// <summary>
    /// Discord's handler with the redirect URI taken from <c>Ember:WebOrigin</c> (never the request host) for the authorize
    /// redirect and the token exchange, and with a failed user-info call reported as a remote failure that keeps the flow.
    /// </summary>
    private sealed class EmberDiscordHandler(
        IOptionsMonitor<DiscordAuthenticationOptions> options, ILoggerFactory logger, UrlEncoder encoder, IConfiguration configuration)
        : DiscordAuthenticationHandler(options, logger, encoder)
    {
        protected override string BuildChallengeUrl(AuthenticationProperties properties, string redirectUri)
            => base.BuildChallengeUrl(properties, RedirectUri());

        protected override Task<OAuthTokenResponse> ExchangeCodeAsync(OAuthCodeExchangeContext context)
            => base.ExchangeCodeAsync(new OAuthCodeExchangeContext(context.Properties, context.Code, RedirectUri()));

        protected override async Task<HandleRequestResult> HandleRemoteAuthenticateAsync()
        {
            try
            {
                return await base.HandleRemoteAuthenticateAsync();
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                return HandleRequestResult.Fail(exception, Options.StateDataFormat.Unprotect(Request.Query["state"]));
            }
        }

        private string RedirectUri()
            => (ApiApp.WebOrigin(configuration) ?? throw new InvalidOperationException("Ember:WebOrigin is not configured."))
               + Options.CallbackPath;
    }
}
