using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using MimeKit.Utils;

namespace Ember.Api.Email;

/// <summary>
/// Sends through the SMTP server in <c>Smtp:Host/Port/User/Password/From</c>: TLS on connect on port 465, required STARTTLS on
/// every other port. The optional <c>Smtp:ReplyTo</c> becomes the <c>Reply-To</c> header.
/// </summary>
internal sealed partial class SmtpEmailTransport(IConfiguration configuration) : IEmailTransport
{
    public async Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        var smtp = configuration.GetSection("Smtp");
        var message = Build(Required(smtp, "From"), to, subject, textBody, smtp["ReplyTo"]);

        var port = smtp.GetValue("Port", 587);
        using var client = new SmtpClient();
        await client.ConnectAsync(Required(smtp, "Host"), port, port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, cancellationToken);
        if (smtp["User"] is { Length: > 0 } user)
            await client.AuthenticateAsync(user, smtp["Password"] ?? "", cancellationToken);
        await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
    }

    /// <summary>
    /// The text body plus an HTML copy (paragraphs, links made clickable), so relays never turn it into an HTML-only
    /// message, and a Message-ID in the sender's domain rather than the container's host name.
    /// </summary>
    internal static MimeMessage Build(string from, string to, string subject, string textBody, string? replyTo = null)
    {
        var sender = MailboxAddress.Parse(from);
        var message = new MimeMessage { Subject = subject, MessageId = MimeUtils.GenerateMessageId(sender.Domain) };
        message.From.Add(sender);
        if (!string.IsNullOrWhiteSpace(replyTo)) message.ReplyTo.Add(MailboxAddress.Parse(replyTo));
        message.To.Add(MailboxAddress.Parse(to));
        message.Body = new BodyBuilder { TextBody = textBody, HtmlBody = Html(textBody) }.ToMessageBody();
        return message;
    }

    /// <summary>
    /// Failures worth one retry: connection and protocol errors, timeouts and the server's 4xx (temporary) replies. A 5xx reply
    /// or missing configuration fails for good.
    /// </summary>
    internal static bool IsTransient(Exception e) => e switch
    {
        SmtpCommandException command => (int)command.StatusCode < 500,
        ProtocolException or IOException or SocketException or TimeoutException or OperationCanceledException => true,
        _ => false,
    };

    private static string Html(string text)
    {
        var paragraphs = text.Split("\n\n").Select(paragraph =>
            "<p>" + Url().Replace(WebUtility.HtmlEncode(paragraph).Replace("\n", "<br>"),
                url => $"<a href=\"{url.Value}\" style=\"word-break:break-all\">{url.Value}</a>") + "</p>");
        return $"<!doctype html><html><body style=\"font-family:sans-serif;line-height:1.5\">{string.Concat(paragraphs)}</body></html>";
    }

    [GeneratedRegex(@"https?://[^\s<]+")]
    private static partial Regex Url();

    private static string Required(IConfigurationSection smtp, string key)
        => smtp[key] is { Length: > 0 } value ? value : throw new InvalidOperationException($"Smtp:{key} is not configured.");
}
