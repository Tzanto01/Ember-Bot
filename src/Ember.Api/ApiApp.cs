using System.Net;
using Ember.Api.Email;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Authentication.BearerToken;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.FileProviders;

namespace Ember.Api;

/// <summary>
/// Composition of the Ember API. <see cref="CreateBuilder"/> registers every service (tests and the test host replace
/// registrations such as <see cref="IEmailTransport"/>, <see cref="TimeProvider"/> or the <see cref="EmberDbContext"/> options
/// before calling <see cref="Build"/>); <see cref="Build"/> validates the configuration and builds the pipeline.
/// The API never runs migrations and hosts no background jobs.
/// </summary>
public static class ApiApp
{
    private const string ContentSecurityPolicy = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

    public static WebApplicationBuilder CreateBuilder(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024);
        var services = builder.Services;
        var config = builder.Configuration;

        services.AddDbContext<EmberDbContext>(options => options.UseNpgsql(config.GetConnectionString("DefaultConnection")));
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<HabitService>();

        services.AddProblemDetails(options => options.CustomizeProblemDetails = Problems.Customize);
        services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);

        services.AddIdentityApiEndpoints<User>(options =>
            {
                options.SignIn.RequireConfirmedEmail = true;
                options.User.RequireUniqueEmail = true;
                options.User.AllowedUserNameCharacters = "";
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.Lockout.AllowedForNewUsers = true;
                options.Password.RequiredLength = 10;
                options.Password.RequiredUniqueChars = 1;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;
            })
            .AddEntityFrameworkStores<EmberDbContext>()
            .AddSignInManager<EmberSignInManager>();
        services.Replace(ServiceDescriptor.Scoped<IUserValidator<User>, EmberUserValidator>());
        services.AddAuthentication().AddEmberDiscord(config, builder.Environment);
        services.Configure<BearerTokenOptions>(IdentityConstants.BearerScheme, options =>
        {
            options.BearerTokenExpiration = TimeSpan.FromMinutes(15);
            options.RefreshTokenExpiration = AuthSessions.Lifetime;
        });
        services.AddMemoryCache();
        services.AddScoped<AuthSessions>();
        services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.FromMinutes(5));
        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.ExpireTimeSpan = AuthSessions.Lifetime;
            options.Events.OnValidatePrincipal = AuthSessions.ValidateCookie(options.Events.OnValidatePrincipal);
            if (!builder.Environment.IsDevelopment())
            {
                options.Cookie.Name = "__Host-Ember";
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            }
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });
        services.AddAuthorization();
        services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-XSRF-TOKEN";
            options.Cookie.SameSite = SameSiteMode.Strict;
            if (!builder.Environment.IsDevelopment()) options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        });

        services.AddSingleton<EmberEmailSender>();
        services.AddSingleton<IEmailSender<User>>(sp => sp.GetRequiredService<EmberEmailSender>());
        if (string.IsNullOrEmpty(config["Smtp:Host"]))
            services.AddSingleton<IEmailTransport, LoggingEmailTransport>();
        else
            services.AddSingleton<IEmailTransport, SmtpEmailTransport>();

        services.AddEmberRateLimits(config);
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            foreach (var proxy in KnownProxies(config))
                options.KnownProxies.Add(IPAddress.Parse(proxy));
            foreach (var network in KnownNetworks(config))
                options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        });
        services.AddCors();
        services.AddSingleton<ICorsPolicyProvider, EmberCorsPolicyProvider>();

        var dataProtection = services.AddDataProtection().SetApplicationName("Ember");
        if (config["Ember:DataProtectionKeysPath"] is { Length: > 0 } keysPath)
            dataProtection.PersistKeysToFileSystem(new DirectoryInfo(keysPath));

        services.AddHealthChecks().AddDbContextCheck<EmberDbContext>();

        return builder;
    }

    /// <param name="builder">From <see cref="CreateBuilder"/>, with any test replacements applied.</param>
    /// <param name="mapExtra">Maps additional endpoints (the test host's <c>/test/*</c>) before the fallbacks.</param>
    public static WebApplication Build(WebApplicationBuilder builder, Action<WebApplication>? mapExtra = null)
    {
        if (!builder.Environment.IsDevelopment()) ValidateConfiguration(builder.Configuration);

        var app = builder.Build();
        _ = NativeOrigins(app.Configuration);

        app.UseForwardedHeaders();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        if (!app.Environment.IsDevelopment())
        {
            app.UseHsts();
            app.UseHttpsRedirection();
        }
        app.Use(SecurityHeaders);
        app.Use(AuthEndpoints.HideIdentityManage);

        var webRoot = app.Configuration["Ember:WebRoot"] is { Length: > 0 } webRootPath
            ? new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(Path.GetFullPath(webRootPath)),
                ContentTypeProvider = WebContentTypes(),
                OnPrepareResponse = static context => context.Context.Response.Headers.CacheControl =
                    context.Context.Request.Path.StartsWithSegments("/assets") ? "public, max-age=31536000, immutable" : "no-cache",
            }
            : null;
        if (webRoot is not null) app.UseStaticFiles(webRoot);

        app.UseRouting();
        app.UseCors();
        app.UseRateLimiter();
        app.UseAuthentication();
        app.Use(AuthSessions.RejectEndedBearer);
        app.Use(AuthEndpoints.EnforceAntiforgery);
        app.UseAuthorization();

        app.MapHealthChecks("/health");

        var api = app.MapGroup("/api");
        var auth = api.MapGroup("/auth").RequireRateLimiting(RateLimits.AuthOtherPolicy);
        auth.MapAuth();
        auth.MapDiscord();

        var signedIn = api.MapGroup("").RequireAuthorization();
        signedIn.MapMe();
        signedIn.MapImport();
        signedIn.MapTwoFactor();
        signedIn.MapDiscordUnlink();
        signedIn.MapMerge();
        signedIn.MapHabits();
        signedIn.MapRoutines();
        signedIn.MapLowDays();
        signedIn.MapJournal();
        signedIn.MapStats();

        api.MapHabitTemplates();
        api.MapPush();

        mapExtra?.Invoke(app);

        app.MapFallback("/api/{**rest}", () => Problems.NotFound());
        if (webRoot is not null) app.MapFallbackToFile("index.html", webRoot);

        return app;
    }

    /// <summary><c>Ember:WebOrigin</c> without a trailing slash, or null when it isn't configured.</summary>
    internal static string? WebOrigin(IConfiguration configuration)
        => configuration["Ember:WebOrigin"] is { Length: > 0 } origin ? origin.TrimEnd('/') : null;

    /// <summary>
    /// The comma-separated <c>Ember:NativeOrigins</c> (default <c>https://localhost,capacitor://localhost</c> when unset; an
    /// empty value means none), each trimmed, without one trailing slash and normalized.
    /// </summary>
    /// <exception cref="InvalidOperationException">An entry isn't an exact origin (<c>scheme://host[:port]</c>), such as <c>*</c>.</exception>
    internal static string[] NativeOrigins(IConfiguration configuration)
        => (configuration["Ember:NativeOrigins"] ?? "https://localhost,capacitor://localhost")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(entry => ExactOrigin(entry.EndsWith('/') ? entry[..^1] : entry)
                ?? throw new InvalidOperationException($"Ember:NativeOrigins entries must be exact origins (scheme://host[:port]); '{entry}' is not."))
            .ToArray();

    private static string? ExactOrigin(string entry)
    {
        var authority = entry.IndexOf("://", StringComparison.Ordinal) + 3;
        if (authority < 3 || entry.AsSpan(authority).IndexOfAny("/?#@\\*") >= 0) return null;
        return Uri.TryCreate(entry, UriKind.Absolute, out var uri) && uri.Host.Length > 0 ? uri.GetLeftPart(UriPartial.Authority) : null;
    }

    private static void ValidateConfiguration(IConfiguration configuration)
    {
        string[] required = ["Smtp:Host", "Smtp:From", "Ember:WebOrigin", "Ember:DataProtectionKeysPath", "Discord:ClientId", "Discord:ClientSecret"];
        var missing = required.Where(key => string.IsNullOrWhiteSpace(configuration[key])).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Missing configuration outside Development: {string.Join(", ", missing)}.");
        if (!Uri.TryCreate(WebOrigin(configuration), UriKind.Absolute, out var origin) || origin.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Ember:WebOrigin must be an absolute https URL outside Development.");
        if (KnownProxies(configuration).Length == 0 && KnownNetworks(configuration).Length == 0)
            throw new InvalidOperationException(
                "Ember:ForwardedHeaders:KnownProxies or Ember:ForwardedHeaders:KnownNetworks must be set outside Development.");
    }

    private static FileExtensionContentTypeProvider WebContentTypes()
    {
        var provider = new FileExtensionContentTypeProvider();
        provider.Mappings[".md"] = "text/markdown";
        return provider;
    }

    private static string[] KnownProxies(IConfiguration configuration)
        => Entries(configuration, "Ember:ForwardedHeaders:KnownProxies");

    private static string[] KnownNetworks(IConfiguration configuration)
        => Entries(configuration, "Ember:ForwardedHeaders:KnownNetworks");

    private static string[] Entries(IConfiguration configuration, string key)
        => configuration.GetSection(key).GetChildren().Select(entry => entry.Value).OfType<string>().Where(value => value.Trim().Length > 0).ToArray();

    /// <summary>
    /// Security headers on every response. <c>X-Robots-Tag: noindex</c> goes on everything except <c>/</c> and static files
    /// outside <c>/legal</c>, judged by the path as requested, since the SPA fallback rewrites it to <c>/index.html</c>.
    /// </summary>
    private static Task SecurityHeaders(HttpContext http, RequestDelegate next)
    {
        var path = http.Request.Path;
        http.Response.OnStarting(() =>
        {
            var headers = http.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";
            headers.ContentSecurityPolicy = ContentSecurityPolicy;
            if (path.StartsWithSegments("/api")) headers.CacheControl = "no-store";
            var staticFile = http.GetEndpoint() is null && http.Request.Path == path && http.Response.StatusCode < 400
                && !path.StartsWithSegments("/legal");
            if (path != "/" && !staticFile) headers["X-Robots-Tag"] = "noindex";
            return Task.CompletedTask;
        });
        return next(http);
    }
}
