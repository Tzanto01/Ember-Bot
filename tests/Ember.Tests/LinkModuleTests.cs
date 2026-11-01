using Ember.Bot.Modules;
using FluentAssertions;
using Microsoft.Extensions.Configuration;

namespace Ember.Tests;

public class LinkModuleTests
{
    private static IConfiguration Config(params (string Key, string Value)[] values)
        => new ConfigurationBuilder().AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value)).Build();

    [Fact]
    public void Reply_points_to_the_settings_page_of_the_configured_web_origin()
    {
        var reply = LinkModule.ReplyText(Config(("Ember:WebOrigin", "https://ember.example/")));

        reply.Should().Contain("https://ember.example/settings").And.NotContain("//settings");
    }

    [Fact]
    public void Reply_says_linking_is_not_available_without_a_web_origin()
    {
        LinkModule.ReplyText(Config()).Should().Be(LinkModule.NotAvailableText);
    }
}
