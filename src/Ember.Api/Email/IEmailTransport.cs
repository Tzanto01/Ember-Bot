namespace Ember.Api.Email;

/// <summary>Delivers one plain-text email. Replace this registration to capture emails in tests.</summary>
public interface IEmailTransport
{
    Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken);
}
