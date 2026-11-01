using System.Net;
using Ember.Api.Email;
using Ember.Core.Data;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
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
    private const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
        "manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    public static WebApplicationBuilder CreateBuilder(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
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
            .AddEntityFrameworkStores<EmberDbContext>();
        services.Configure<SecurityStampValidatorOptions>(options => options.ValidationInterval = TimeSpan.FromMinutes(5));
        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
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
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            foreach (var proxy in config.GetSection("Ember:ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
                options.KnownProxies.Add(IPAddress.Parse(proxy));
            foreach (var network in config.GetSection("Ember:ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
                options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        });
        services.AddCors();

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
            ? new PhysicalFileProvider(Path.GetFullPath(webRootPath))
            : null;
        if (webRoot is not null) app.UseStaticFiles(new StaticFileOptions { FileProvider = webRoot });

        app.UseRouting();
        var origin = WebOrigin(app.Configuration);
        app.UseCors(policy =>
        {
            if (origin is not null) policy.WithOrigins(origin).AllowCredentials().AllowAnyHeader().AllowAnyMethod();
        });
        app.UseAuthentication();
        app.UseRateLimiter();
        app.Use(AuthEndpoints.EnforceAntiforgery);
        app.UseAuthorization();

        app.MapHealthChecks("/health");

        var api = app.MapGroup("/api");
        var auth = api.MapGroup("/auth").RequireRateLimiting(RateLimits.AuthPolicy);
        auth.MapAuth();

        var signedIn = api.MapGroup("").RequireAuthorization();
        signedIn.MapMe();
        signedIn.MapHabits();
        signedIn.MapLowDays();
        signedIn.MapStats();

        api.MapHabitTemplates();
        api.MapPush();

        mapExtra?.Invoke(app);

        app.MapFallback("/api/{**rest}", () => Problems.NotFound());
        if (webRoot is not null) app.MapFallbackToFile("index.html", new StaticFileOptions { FileProvider = webRoot });

        return app;
    }

    /// <summary><c>Ember:WebOrigin</c> without a trailing slash, or null when it isn't configured.</summary>
    internal static string? WebOrigin(IConfiguration configuration)
        => configuration["Ember:WebOrigin"] is { Length: > 0 } origin ? origin.TrimEnd('/') : null;

    private static void ValidateConfiguration(IConfiguration configuration)
    {
        string[] required = ["Smtp:Host", "Smtp:From", "Ember:WebOrigin", "Ember:DataProtectionKeysPath"];
        var missing = required.Where(key => string.IsNullOrWhiteSpace(configuration[key])).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Missing configuration outside Development: {string.Join(", ", missing)}.");
        if (!Uri.TryCreate(WebOrigin(configuration), UriKind.Absolute, out var origin) || origin.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Ember:WebOrigin must be an absolute https URL outside Development.");
    }

    private static Task SecurityHeaders(HttpContext http, RequestDelegate next)
    {
        http.Response.OnStarting(() =>
        {
            var headers = http.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers["Referrer-Policy"] = "no-referrer";
            headers.ContentSecurityPolicy = ContentSecurityPolicy;
            if (http.Request.Path.StartsWithSegments("/api")) headers.CacheControl = "no-store";
            return Task.CompletedTask;
        });
        return next(http);
    }
}
