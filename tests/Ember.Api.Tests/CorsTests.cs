using System.Net;
using FluentAssertions;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class CorsTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private async Task<HttpResponseMessage> Preflight(string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, "/api/habits");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "authorization,content-type");
        return await Host.NewClient().Http.SendAsync(request);
    }

    private static string? Header(HttpResponseMessage response, string name)
        => response.Headers.TryGetValues(name, out var values) ? values.Single() : null;

    [DockerFact]
    public async Task Default_native_origins_are_allowed_without_credentials()
    {
        foreach (var origin in new[] { "capacitor://localhost", "https://localhost" })
        {
            var response = await Preflight(origin);

            response.IsSuccessStatusCode.Should().BeTrue(origin);
            Header(response, "Access-Control-Allow-Origin").Should().Be(origin);
            Header(response, "Access-Control-Allow-Headers")!.ToLowerInvariant().Should().ContainAll("authorization", "content-type");
            Header(response, "Access-Control-Allow-Credentials").Should().BeNull();
        }
    }

    [DockerFact]
    public async Task The_web_origin_keeps_credentials()
    {
        var response = await Preflight(ApiHost.WebOrigin);

        Header(response, "Access-Control-Allow-Origin").Should().Be(ApiHost.WebOrigin);
        Header(response, "Access-Control-Allow-Credentials").Should().Be("true");
    }

    [DockerFact]
    public async Task Unknown_origins_get_no_cors_headers()
    {
        var preflight = await Preflight("https://evil.example");
        var simple = new HttpRequestMessage(HttpMethod.Get, "/health");
        simple.Headers.Add("Origin", "https://evil.example");
        var get = await Host.NewClient().Http.SendAsync(simple);

        foreach (var response in new[] { preflight, get })
            response.Headers.Select(h => h.Key).Should().NotContain(k => k.StartsWith("Access-Control-"));
    }
}

[Collection("Postgres")]
public class CorsNativeOriginsConfigTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    protected override Dictionary<string, string?>? Settings => new() { ["Ember:NativeOrigins"] = " https://native.example/ ,capacitor://app " };

    [DockerFact]
    public async Task Configured_native_origins_replace_the_defaults_after_trimming()
    {
        foreach (var (origin, allowed) in new[] { ("https://native.example", true), ("capacitor://app", true), ("capacitor://localhost", false) })
        {
            var request = new HttpRequestMessage(HttpMethod.Options, "/api/habits");
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "GET");

            var response = await Host.NewClient().Http.SendAsync(request);

            response.Headers.Contains("Access-Control-Allow-Origin").Should().Be(allowed, origin);
        }
    }
}

public class NativeOriginsValidationTests
{
    [Theory]
    [InlineData("*")]
    [InlineData("https://x.example/app")]
    public void Starting_the_api_fails_for_a_wildcard_or_an_origin_with_a_path(string value)
    {
        using var host = new ApiHost("Host=localhost;Database=unused", new() { ["Ember:NativeOrigins"] = value });

        var start = () => host.CreateClient();

        start.Should().Throw<Exception>().Which.ToString().Should().Contain("NativeOrigins");
    }
}
