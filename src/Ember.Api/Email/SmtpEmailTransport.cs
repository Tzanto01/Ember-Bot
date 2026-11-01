using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Ember.Api.Email;

/// <summary>Sends through the SMTP server in <c>Smtp:Host/Port/User/Password/From</c>: TLS on connect on port 465, required STARTTLS on every other port.</summary>
internal sealed class SmtpEmailTransport(IConfiguration configuration) : IEmailTransport
{
    public async Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        var smtp = configuration.GetSection("Smtp");
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(Required(smtp, "From")));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new TextPart("plain") { Text = textBody };

        var port = smtp.GetValue("Port", 587);
        using var client = new SmtpClient();
        await client.ConnectAsync(Required(smtp, "Host"), port, port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, cancellationToken);
        if (smtp["User"] is { Length: > 0 } user)
            await client.AuthenticateAsync(user, smtp["Password"] ?? "", cancellationToken);
        await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }

    private static string Required(IConfigurationSection smtp, string key)
        => smtp[key] is { Length: > 0 } value ? value : throw new InvalidOperationException($"Smtp:{key} is not configured.");
}
