using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class SecurityTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    [DockerFact]
    public async Task Cookie_authenticated_writes_without_the_antiforgery_header_are_refused_and_write_nothing()
    {
        var client = await Host.SignedInAsync();
        var original = $"Original {Guid.NewGuid():N}";
        var id = (await client.CreateHabitAsync(original)).GetProperty("id").GetInt32();
        var token = client.Csrf;
        client.Csrf = null;

        await (await client.Post("/api/habits", new { name = "Second", frequency = "daily" })).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");
        await (await client.Patch($"/api/habits/{id}", new { name = "Renamed" })).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");
        await (await client.Delete($"/api/habits/{id}")).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");

        client.Csrf = token;
        var habits = await (await client.Get("/api/habits")).ExpectJson();
        habits.GetArrayLength().Should().Be(1);
        habits[0].GetProperty("name").GetString().Should().Be(original);
    }

    [DockerFact]
    public async Task A_wrong_token_or_another_users_token_is_refused_and_the_own_token_works()
    {
        var a = await Host.SignedInAsync();
        var b = await Host.SignedInAsync();
        var own = a.Csrf;

        a.Csrf = "not-a-token";
        await (await a.Post("/api/habits", new { name = "Water", frequency = "daily" })).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");
        a.Csrf = b.Csrf;
        await (await a.Post("/api/habits", new { name = "Water", frequency = "daily" })).ExpectProblem(HttpStatusCode.Forbidden, "antiforgery");
        (await (await a.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);

        a.Csrf = own;
        await (await a.Post("/api/habits", new { name = "Water", frequency = "daily" })).Expect(HttpStatusCode.Created);
    }

    [DockerFact]
    public async Task Bearer_authenticated_writes_need_no_antiforgery_token()
    {
        var user = await Host.ConfirmedUserAsync();
        var tokens = await (await user.Post("/api/auth/login", new Credentials(user.Email, ApiClient.Passphrase))).ExpectJson();
        var bearer = Host.NewClient();
        bearer.Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens.GetProperty("accessToken").GetString());

        await bearer.GiveConsentAsync();
        await bearer.CreateHabitAsync();

        bearer.Csrf.Should().BeNull();
    }

    [DockerFact]
    public async Task Unknown_api_paths_are_a_not_found_problem_and_identity_manage_is_not_exposed()
    {
        var anonymous = Host.NewClient();
        var signedIn = await Host.SignedInAsync(consent: false);

        await (await anonymous.Get("/api/whatever")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await signedIn.Get("/api/whatever/deeper")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await anonymous.Get("/api/auth/manage/info")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await signedIn.Get("/api/auth/manage/info")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Api_responses_are_never_cached_and_carry_the_security_headers()
    {
        var signedIn = await Host.SignedInAsync(consent: false);

        var responses = new[]
        {
            await signedIn.Get("/api/me"),
            await signedIn.Get("/api/whatever"),
            await Host.NewClient().Get("/api/habits"),
        };

        foreach (var response in responses)
        {
            response.Headers.CacheControl!.NoStore.Should().BeTrue();
            response.Headers.GetValues("X-Content-Type-Options").Should().Contain("nosniff");
            response.Headers.GetValues("Referrer-Policy").Should().Contain("no-referrer");
            response.Headers.GetValues("Content-Security-Policy").Single().Should().Contain("frame-ancestors 'none'");
        }
    }
}
