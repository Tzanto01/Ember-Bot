using Ember.Api.Email;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
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

        message.Body!.ContentType.MimeType.Should().Be("multipart/alternative");
        message.TextBody.Should().Contain(Link);
        message.HtmlBody.Should().Contain($"<a href=\"{Link.Replace("&", "&amp;")}\"")
            .And.Contain("Welcome &lt;to&gt; Ember.")
            .And.Contain("Open this link:<br>");
    }

    [Fact]
    public void Message_id_uses_the_sender_domain()
        => Message().MessageId.Should().EndWith("@ember.example");

    [Fact]
    public void Reply_to_is_set_only_when_configured()
    {
        SmtpEmailTransport.Build("noreply@ember.example", "someone@example.test", "Hi", "Body", "help@ember.example")
            .ReplyTo.Mailboxes.Select(m => m.Address).Should().Equal("help@ember.example");
        Message().ReplyTo.Count.Should().Be(0);
    }
}

public class EmberEmailSenderTests
{
    private sealed class FlakyTransport(Exception firstFailure) : IEmailTransport
    {
        public int Attempts;
        public int Delivered;

        public Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref Attempts) == 1) throw firstFailure;
            Interlocked.Increment(ref Delivered);
            return Task.CompletedTask;
        }
    }

    [Fact]
    public async Task A_transient_failure_is_retried_once_after_a_delay()
    {
        var transport = new FlakyTransport(new IOException("connection reset"));
        var time = new FakeTimeProvider();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ember:WebOrigin"] = "https://ember.example" }).Build();
        var sender = new EmberEmailSender(transport, configuration, time, null!, NullLogger<EmberEmailSender>.Instance);

        await sender.SendAlreadyRegisteredAsync("someone@example.test");
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (Volatile.Read(ref transport.Attempts) == 0 && DateTime.UtcNow < deadline) await Task.Delay(10);
        await Task.Delay(100);
        transport.Delivered.Should().Be(0);

        while (Volatile.Read(ref transport.Delivered) == 0 && DateTime.UtcNow < deadline)
        {
            time.Advance(EmberEmailSender.RetryDelay);
            await Task.Delay(10);
        }

        transport.Delivered.Should().Be(1);
        transport.Attempts.Should().Be(2);
    }
}
