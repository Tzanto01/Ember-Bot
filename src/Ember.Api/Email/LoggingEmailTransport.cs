namespace Ember.Api.Email;

/// <summary>Development stand-in when no SMTP server is configured: logs recipient and subject, never the body (it holds codes).</summary>
internal sealed class LoggingEmailTransport(ILogger<LoggingEmailTransport> logger) : IEmailTransport
{
    public Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        logger.LogInformation("Email not sent (no SMTP configured): {Subject} to {Recipient}", subject, to);
        return Task.CompletedTask;
    }
}
