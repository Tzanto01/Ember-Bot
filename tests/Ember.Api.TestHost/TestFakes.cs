using AspNet.Security.OAuth.Discord;
using Ember.Api.Email;
using Ember.Core.Models;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Ember.Api.TestHost;

public static class TestFakes
{
    /// <summary>Path of the fake Discord authorize step mapped by <see cref="TestEndpoints.MapEmberTestEndpoints"/>.</summary>
    public const string AuthorizePath = "/test/discord/authorize";

    /// <summary>
    /// Replaces the email transport with a singleton <see cref="OutboxEmailTransport"/> and fakes Discord at the backchannel
    /// with a singleton <see cref="FakeDiscord"/>, keeping the real Discord OAuth handler (dummy client ID and secret).
    /// Call after <see cref="ApiApp.CreateBuilder"/>.
    /// </summary>
    /// <param name="authorizationEndpoint">
    /// Where the challenge sends the browser. Tests that read <c>state</c> from the challenge's <c>Location</c> and call the
    /// callback themselves can keep the default.
    /// </param>
    public static IServiceCollection AddEmberTestFakes(this IServiceCollection services, string authorizationEndpoint = AuthorizePath)
    {
        services.RemoveAll<IEmailTransport>();
        services.AddSingleton<OutboxEmailTransport>();
        services.AddSingleton<IEmailTransport>(sp => sp.GetRequiredService<OutboxEmailTransport>());

        services.AddSingleton<FakeDiscord>();
        services.AddOptions<DiscordAuthenticationOptions>(DiscordLogin.Provider).PostConfigure<FakeDiscord>((options, discord) =>
        {
            options.ClientId = "test-client-id";
            options.ClientSecret = "test-client-secret";
            options.AuthorizationEndpoint = authorizationEndpoint;
            options.BackchannelHttpHandler = discord;
            options.Backchannel = new HttpClient(discord, disposeHandler: false) { Timeout = options.BackchannelTimeout };
        });

        return services;
    }
}
