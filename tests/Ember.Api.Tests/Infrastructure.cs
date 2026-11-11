using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using DotNet.Testcontainers.Configurations;
using Ember.Api.Email;
using Ember.Api.TestHost;
using Ember.Core.Data;
using Ember.Core.Services;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Ember.Api.Tests;

/// <summary>
/// Fact that needs Docker: skipped locally when Docker is unreachable, but never skipped when <c>CI=true</c>,
/// so a CI runner without Docker fails instead of silently passing.
/// </summary>
public sealed class DockerFactAttribute : FactAttribute
{
    internal static readonly bool ShouldRun =
        TestcontainersSettings.OS.DockerEndpointAuthConfig is not null
        || string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase);

    public DockerFactAttribute()
    {
        if (!ShouldRun)
            Skip = "Docker is not available (set CI=true to force these tests to run).";
    }
}

/// <summary>Starts one Postgres container per test run and hands out an empty database per call.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private PostgreSqlContainer? _container;

    public async Task InitializeAsync()
    {
        if (!DockerFactAttribute.ShouldRun)
            return;

        _container = new PostgreSqlBuilder("postgres:17-alpine").Build();
        await _container.StartAsync();
    }

    public async Task<string> CreateDatabaseAsync()
    {
        if (_container is null)
            throw new InvalidOperationException("Postgres container is not running.");

        var name = $"ember_{Guid.NewGuid():N}";
        await using (var connection = new NpgsqlConnection(_container.GetConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
            await command.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Database = name }.ConnectionString;
    }

    public async Task DisposeAsync()
    {
        if (_container is not null)
            await _container.DisposeAsync();
    }
}

[CollectionDefinition("Postgres")]
public class PostgresCollection : ICollectionFixture<PostgresFixture>;

/// <summary>Request bodies of the Identity and account endpoints (camelCase on the wire).</summary>
public sealed record Credentials(string Email, string Password);

public sealed record ConfirmRequest(string UserId, string Code, string Password);

public sealed record ResetRequest(string Email, string ResetCode, string NewPassword);

public sealed record DeleteRequest(string? Password, string? Confirm);

public sealed record SentMail(string To, string Subject, string Body)
{
    /// <summary>The first https link in the body.</summary>
    public string Link() => Regex.Match(Body, @"https://\S+").Value;
}

public sealed class CapturingEmailTransport : IEmailTransport
{
    private readonly ConcurrentQueue<SentMail> _sent = new();

    public Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        _sent.Enqueue(new SentMail(to, subject, textBody));
        return Task.CompletedTask;
    }

    public List<SentMail> To(string email)
        => _sent.Where(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase)).ToList();

    /// <summary>Waits up to 5 seconds until at least <paramref name="count"/> mails to <paramref name="email"/> arrived (the API sends in the background).</summary>
    public async Task<List<SentMail>> WaitForAsync(string email, int count)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (To(email).Count < count && DateTime.UtcNow < deadline)
            await Task.Delay(20);
        return To(email);
    }

    /// <summary>The mails to <paramref name="email"/> after a short settle, for asserting that none were sent.</summary>
    public async Task<List<SentMail>> SettledAsync(string email)
    {
        await Task.Delay(300);
        return To(email);
    }
}

/// <summary>The real API against a fresh migrated database, a capturing mail transport and a fixed clock.</summary>
public sealed class ApiHost : WebApplicationFactory<Program>
{
    /// <summary>Differs from the client's base address so a link built from the request host would be caught.</summary>
    public const string WebOrigin = "https://app.example.test";

    private readonly Dictionary<string, string?> _settings;

    public CapturingEmailTransport Mail { get; } = new();

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 11, 1, 12, 0, 0, TimeSpan.Zero));

    public DateOnly Today => DateOnly.FromDateTime(Time.GetUtcNow().UtcDateTime);

    public ApiHost(string connectionString, Dictionary<string, string?>? extraSettings = null)
    {
        _settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = connectionString,
            ["Ember:WebOrigin"] = WebOrigin,
            ["Ember:RateLimits:AuthPerIpPerMinute"] = "100000",
            ["Ember:RateLimits:AuthOtherPerIpPerMinute"] = "100000",
            ["Ember:RateLimits:MailPerEmailPerHour"] = "1000",
            ["Ember:RateLimits:MailPerEmailAnyClientPerHour"] = "1000",
            ["Ember:RateLimits:MailPerIpPerHour"] = "1000",
            ["Ember:RateLimits:MailPerDay"] = "100000",
        };
        foreach (var (key, value) in extraSettings ?? [])
            _settings[key] = value;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(_settings));
        builder.ConfigureServices(services =>
        {
            services.AddEmberTestFakes();
            services.RemoveAll<IEmailTransport>();
            services.AddSingleton<IEmailTransport>(Mail);
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Time);
        });
    }

    public static string NewEmail() => $"t-{Guid.NewGuid():N}@example.test";

    public ApiClient NewClient() => new(this);

    /// <summary>Registers a new user and confirms the email through the mailed link. Not signed in.</summary>
    public async Task<ApiClient> ConfirmedUserAsync()
    {
        var client = NewClient();
        client.Email = NewEmail();
        await (await client.Post("/api/auth/register", new Credentials(client.Email, ApiClient.Passphrase))).Expect(HttpStatusCode.OK);

        var mail = (await Mail.WaitForAsync(client.Email, 1)).Single();
        await (await OpenConfirmLinkAsync(client, mail, ApiClient.Passphrase)).Expect(HttpStatusCode.OK);
        return client;
    }

    /// <summary>Posts the web link's <c>userId</c> and <c>code</c> from a confirmation mail, with the password entered on the confirm page, to confirmEmail.</summary>
    /// <param name="code">Replaces the code from the link.</param>
    public Task<HttpResponseMessage> OpenConfirmLinkAsync(ApiClient client, SentMail mail, string passphrase, string? code = null)
    {
        var query = QueryHelpers.ParseQuery(new Uri(mail.Link()).Query);
        return client.Post("/api/auth/confirmEmail", new ConfirmRequest(query["userId"].ToString(), code ?? query["code"].ToString(), passphrase));
    }

    /// <summary>A confirmed user signed in with the cookie and an antiforgery token, optionally with the health-data consent.</summary>
    public async Task<ApiClient> SignedInAsync(bool consent = true)
    {
        var client = await ConfirmedUserAsync();
        await client.LoginAsync();
        if (consent) await client.GiveConsentAsync();
        return client;
    }

    /// <summary>Whether the session in <paramref name="client"/>'s cookie is live, as the API's cached lookup sees it.</summary>
    public async Task<bool> SessionIsLiveAsync(ApiClient client)
    {
        using var scope = Services.CreateScope();
        var cookie = scope.ServiceProvider.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(IdentityConstants.ApplicationScheme);
        var ticket = cookie.TicketDataFormat.Unprotect(client.CookieValue(".AspNetCore.Identity.Application"))!;
        return await scope.ServiceProvider.GetRequiredService<AuthSessions>().IsActiveAsync(ticket.Principal);
    }

    public async Task<T> Db<T>(Func<EmberDbContext, Task<T>> query)
    {
        using var scope = Services.CreateScope();
        return await query(scope.ServiceProvider.GetRequiredService<EmberDbContext>());
    }

    /// <summary>Runs <paramref name="action"/> against Core's <see cref="HabitService"/> (what the bot uses), in its own scope.</summary>
    public async Task<T> Service<T>(Func<HabitService, Task<T>> action)
    {
        using var scope = Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<HabitService>());
    }

    public Task Run(Func<HabitService, Task> action) => Service(async service =>
    {
        await action(service);
        return 0;
    });

    public static ulong NewDiscordId() => (ulong)Random.Shared.NextInt64(100_000_000_000_000_000, 900_000_000_000_000_000);

    /// <summary>
    /// Drives a Discord flow through the fake: the challenge at <paramref name="startUrl"/>, the callback (with the state from
    /// the challenge) and the API's own follow-up redirects. Returns the final relative redirect target. A link by a client with
    /// an email first gets its grant with <see cref="ApiClient.Passphrase"/>.
    /// </summary>
    /// <param name="discordId">The Discord user the fake authorizes; null leaves the user-info call failing.</param>
    /// <param name="deny">Ends the authorization as if the user cancelled on Discord.</param>
    /// <param name="beforeComplete">Runs after the callback and before the API's <c>.../complete</c> step.</param>
    public async Task<string> DiscordAsync(ApiClient client, string startUrl, ulong? discordId = null, bool deny = false,
        Func<Task>? beforeComplete = null)
    {
        if (discordId is { } id) Services.GetRequiredService<FakeDiscord>().SetNext(id);

        if (startUrl == "/api/auth/discord/link" && client.Email.Length > 0)
            await (await client.Post("/api/auth/discord/link/start", new { password = ApiClient.Passphrase })).Expect(HttpStatusCode.NoContent);

        var challenge = await client.Get(startUrl);
        challenge.StatusCode.Should().Be(HttpStatusCode.Redirect);
        var authorize = challenge.Headers.Location!.OriginalString;
        var state = Uri.EscapeDataString(QueryHelpers.ParseQuery(authorize[(authorize.IndexOf('?') + 1)..])["state"].ToString());

        var callback = await client.Get($"/api/auth/discord/callback?{(deny ? "error=access_denied" : "code=fake")}&state={state}");
        callback.StatusCode.Should().Be(HttpStatusCode.Redirect);
        var next = callback.Headers.Location!.OriginalString;

        if (beforeComplete is not null) await beforeComplete();
        while (next.StartsWith("/api/auth/discord/", StringComparison.Ordinal))
        {
            var step = await client.Get(next);
            step.StatusCode.Should().Be(HttpStatusCode.Redirect);
            next = step.Headers.Location!.OriginalString;
        }

        return next;
    }
}

/// <summary>An HTTP client with its own cookie jar at <c>https://localhost</c>, no redirects, and the antiforgery token in <see cref="Csrf"/>.</summary>
public sealed partial class ApiClient
{
    public const string Passphrase = "correct-horse-battery";

    private static readonly Uri Origin = new("https://localhost");

    private readonly CookieContainer _jar = new();

    public HttpClient Http { get; }

    public string Email { get; set; } = "";

    /// <summary>Sent as <c>X-XSRF-TOKEN</c> on every request while set.</summary>
    public string? Csrf { get; set; }

    internal ApiClient(ApiHost host) => Http = host.CreateDefaultClient(Origin, new CookieJar(_jar, host.Time));

    /// <summary>The value of a cookie the client would send to <paramref name="path"/>, or null.</summary>
    public string? CookieValue(string name, string path = "/") => _jar.GetCookies(new Uri(Origin, path))[name]?.Value;

    public void AddCookie(string name, string value, string path) => _jar.Add(Origin, new Cookie(name, value, path));

    private string? XsrfCookie => _jar.GetCookies(Origin)["XSRF-TOKEN"] is { } cookie ? Uri.UnescapeDataString(cookie.Value) : null;

    public Task<HttpResponseMessage> Send(HttpMethod method, string url, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null) request.Content = JsonContent.Create(body);
        if (Csrf is not null) request.Headers.Add("X-XSRF-TOKEN", Csrf);
        return Http.SendAsync(request);
    }

    public Task<HttpResponseMessage> Get(string url) => Send(HttpMethod.Get, url);
    public Task<HttpResponseMessage> Post(string url, object? body = null) => Send(HttpMethod.Post, url, body);
    public Task<HttpResponseMessage> Put(string url, object? body = null) => Send(HttpMethod.Put, url, body);
    public Task<HttpResponseMessage> Patch(string url, object? body = null) => Send(HttpMethod.Patch, url, body);
    public Task<HttpResponseMessage> Delete(string url) => Send(HttpMethod.Delete, url);

    public async Task RefreshCsrfAsync()
    {
        await (await Get("/api/auth/antiforgery")).Expect(HttpStatusCode.NoContent);
        Csrf = XsrfCookie;
        Csrf.Should().NotBeNullOrEmpty();
    }

    public async Task LoginAsync(string? passphrase = null)
    {
        await (await Post("/api/auth/login?useCookies=true", new Credentials(Email, passphrase ?? Passphrase))).Expect(HttpStatusCode.OK);
        await RefreshCsrfAsync();
    }

    public async Task GiveConsentAsync()
        => await (await Post("/api/me/consent", new { policyVersion = HabitService.CurrentConsentPolicyVersion })).Expect(HttpStatusCode.NoContent);

    public async Task<Guid> IdAsync()
        => Guid.Parse((await (await Get("/api/me")).ExpectJson()).GetProperty("id").GetString()!);

    public async Task<JsonElement> CreateHabitAsync(string? name = null, string frequency = "daily")
        => await (await Post("/api/habits", new { name = name ?? $"Habit {Guid.NewGuid():N}", frequency })).ExpectJson(HttpStatusCode.Created);

    /// <summary>
    /// The server stamps a cookie's <c>expires</c> from <see cref="ApiHost.Time"/>, but <see cref="CookieContainer"/> checks it
    /// against the real clock. Each <c>expires</c> is moved by the real clock's lead over the fake one, so cookies live as long
    /// as the server meant, whatever day the tests run on.
    /// </summary>
    private sealed class CookieJar(CookieContainer jar, TimeProvider serverTime) : DelegatingHandler
    {
        private static readonly Regex Expires = new(@"(?<=;\s*expires=)[^;]+", RegexOptions.IgnoreCase);

        private string ToRealClock(string setCookie) => Expires.Replace(setCookie, m =>
            DateTimeOffset.TryParse(m.Value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var expires)
                ? (expires + (DateTimeOffset.UtcNow - serverTime.GetUtcNow())).ToString("R", CultureInfo.InvariantCulture)
                : m.Value);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var header = jar.GetCookieHeader(request.RequestUri!);
            if (header.Length > 0) request.Headers.TryAddWithoutValidation("Cookie", header);

            var response = await base.SendAsync(request, cancellationToken);
            if (response.Headers.TryGetValues("Set-Cookie", out var values))
                foreach (var value in values)
                    jar.SetCookies(request.RequestUri!, ToRealClock(value));
            return response;
        }
    }
}

public abstract class ApiTestBase(PostgresFixture postgres) : IAsyncLifetime
{
    private ApiHost? _host;

    protected ApiHost Host => _host!;

    protected virtual Dictionary<string, string?>? Settings => null;

    public async Task InitializeAsync()
    {
        if (!DockerFactAttribute.ShouldRun)
            return;

        var connectionString = await postgres.CreateDatabaseAsync();
        await using (var db = new EmberDbContext(new DbContextOptionsBuilder<EmberDbContext>().UseNpgsql(connectionString).Options))
            await db.Database.MigrateAsync();

        _host = new ApiHost(connectionString, Settings);
    }

    public async Task DisposeAsync()
    {
        if (_host is not null)
            await _host.DisposeAsync();
        NpgsqlConnection.ClearAllPools();
    }
}

internal static class HttpExtensions
{
    public static string Iso(this DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Asserts the status code (the body is part of the failure message) and returns the body.</summary>
    public static async Task<string> Expect(this HttpResponseMessage response, HttpStatusCode status)
    {
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(status, "the response body was {0}", body);
        return body;
    }

    public static async Task<JsonElement> ExpectJson(this HttpResponseMessage response, HttpStatusCode status = HttpStatusCode.OK)
        => JsonDocument.Parse(await response.Expect(status)).RootElement.Clone();

    /// <summary>Asserts an <c>application/problem+json</c> response and, when given, its <c>type</c>.</summary>
    public static async Task<JsonElement> ExpectProblem(this HttpResponseMessage response, HttpStatusCode status, string? type = null)
    {
        var problem = await response.ExpectJson(status);
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/problem+json");
        response.Headers.Location.Should().BeNull();
        if (type is not null) problem.GetProperty("type").GetString().Should().Be(type);
        return problem;
    }

    public static bool Has(this JsonElement element, string property) => element.TryGetProperty(property, out _);
}
