using Ember.Api.Email;
using FluentAssertions;
using MimeKit;

namespace Ember.Api.Tests;

public class SmtpEmailTransportTests
{
    private const string Link = "https://ember.example/confirm-email?userId=u1&code=a%2Bb";

    private static MimeMessage Message() => SmtpEmailTransport.Build(
        "Ember <noreply@ember.example>", "someone@example.test", "Confirm",
        $"Welcome <to> Ember.\n\nOpen this link:\n{Link}\n\nThanks.");

    [Fact]
    public void Sends_the_text_with_an_html_copy_whose_links_are_clickable_and_whose_text_is_encoded()
    {
        var message = Message();

        message.Body.ContentType.MimeType.Should().Be("multipart/alternative");
        message.TextBody.Should().Contain(Link);
        message.HtmlBody.Should().Contain($"<a href=\"{Link.Replace("&", "&amp;")}\"")
            .And.Contain("Welcome &lt;to&gt; Ember.")
            .And.Contain("Open this link:<br>");
    }

    [Fact]
    public void Message_id_uses_the_sender_domain()
        => Message().MessageId.Should().EndWith("@ember.example");
}
