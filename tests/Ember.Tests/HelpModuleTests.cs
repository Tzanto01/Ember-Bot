using Ember.Bot.Modules;
using FluentAssertions;
using Microsoft.Extensions.Configuration;

namespace Ember.Tests;

public class HelpModuleTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values)
        => new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    [Fact]
    public void Help_links_the_privacy_policy_and_imprint_of_the_web_app()
    {
        var embed = HelpModule.HelpEmbed(Config(("Ember:PrivacyPolicyUrl", "https://ember.example/legal/privacy")));

        embed.Fields.Should().ContainSingle(f => f.Name == "Legal").Which.Value.Should()
            .Be("[Privacy policy](https://ember.example/legal/privacy) · [Imprint](https://ember.example/legal/imprint)");
    }

    [Fact]
    public void Help_links_only_the_privacy_policy_when_it_is_hosted_elsewhere()
    {
        var embed = HelpModule.HelpEmbed(Config(("Ember:PrivacyPolicyUrl", "https://policies.example/ember")));

        embed.Fields.Should().ContainSingle(f => f.Name == "Legal").Which.Value.Should()
            .Be("[Privacy policy](https://policies.example/ember)");
    }

    [Fact]
    public void Help_shows_no_legal_links_without_a_privacy_policy_url()
    {
        var embed = HelpModule.HelpEmbed(Config());

        embed.Fields.Should().NotContain(f => f.Name == "Legal");
        embed.Fields.Select(f => f.Value).Should().NotContain(v => v.Contains("Privacy policy"));
    }
}
