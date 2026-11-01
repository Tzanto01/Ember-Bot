using System.Globalization;
using System.Security.Claims;
using System.Text.Encodings.Web;
using AspNet.Security.OAuth.Discord;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace Ember.Api;

/// <summary>Discord sign-in, linking and unlinking. Every outcome ends in a redirect to a web app page.</summary>
internal static class DiscordEndpoints
{
    public const string CallbackPath = "/api/auth/discord/callback";

    private const string FlowKey = "ember.flow";
    private const string LoginFlow = "login";
    private const string LinkFlow = "link";

    private const string LoginError = "/login?discord=error";
    private const string LinkError = "/settings?discord=error";
    private const string Linked = "/settings?discord=linked";
    private const string LinkConflict = "/settings?discord=conflict";
    private const string MergePage = "/link/merge";

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
                context.Response.Redirect(flow == LinkFlow ? LinkError : LoginError);
                context.HandleResponse();
                return Task.CompletedTask;
            };
        });

    public static RouteGroupBuilder MapDiscord(this RouteGroupBuilder auth)
    {
        auth.MapGet("/discord/login", (string? returnUrl, SignInManager<User> signIn) =>
            Results.Challenge(
                Properties(signIn, LoginFlow, $"/api/auth/discord/login/complete?returnUrl={Uri.EscapeDataString(LocalOrToday(returnUrl))}"),
                [DiscordLogin.Provider]));

        auth.MapGet("/discord/login/complete", async (string? returnUrl, HttpContext http, SignInManager<User> signIn,
            UserManager<User> users, HabitService habits) =>
        {
            var info = await signIn.GetExternalLoginInfoAsync();
            await http.SignOutAsync(IdentityConstants.ExternalScheme);
            if (DiscordId(info, LoginFlow) is not { } discordId) return Results.Redirect(LoginError);

            var userId = await habits.ResolveOrCreateDiscordUserAsync(discordId);
            var user = await users.FindByIdAsync(userId.ToString());
            if (user is null || await users.IsLockedOutAsync(user)) return Results.Redirect(LoginError);

            await signIn.SignInAsync(user, isPersistent: true, authenticationMethod: DiscordLogin.Provider);
            return Results.Redirect(LocalOrToday(returnUrl));
        });

        auth.MapGet("/discord/link", (ClaimsPrincipal principal, SignInManager<User> signIn, UserManager<User> users) =>
                Results.Challenge(Properties(signIn, LinkFlow, "/api/auth/discord/link/complete", users.GetUserId(principal)), [DiscordLogin.Provider]))
            .RequireAuthorization();

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
                if (!(await users.AddLoginAsync(user, new UserLoginInfo(DiscordLogin.Provider, key, DiscordLogin.Provider))).Succeeded)
                    return Results.Redirect(LinkConflict);
                await users.UpdateSecurityStampAsync(user);
                await signIn.RefreshSignInAsync(user);
                return Results.Redirect(Linked);
            }

            if (owner.PasswordHash is not null || owner.Email is not null) return Results.Redirect(LinkConflict);

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

    /// <summary>A local path (a single leading <c>/</c>, no <c>//</c>, <c>/\</c> or control characters), else <c>/today</c>.</summary>
    internal static string LocalOrToday(string? returnUrl)
        => returnUrl is ['/', ..] && (returnUrl.Length == 1 || returnUrl[1] is not ('/' or '\\')) && !returnUrl.Any(char.IsControl)
            ? returnUrl
            : "/today";

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
