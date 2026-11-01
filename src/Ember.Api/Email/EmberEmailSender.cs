using System.Net;
using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace Ember.Api.Email;

/// <summary>Identity's account emails, with links into the web app at <c>Ember:WebOrigin</c> (never the request host).</summary>
internal sealed class EmberEmailSender(IEmailTransport transport, IConfiguration configuration, ILogger<EmberEmailSender> logger)
    : IEmailSender<User>
{
    private string Origin => ApiApp.WebOrigin(configuration)
        ?? throw new InvalidOperationException("Ember:WebOrigin is not configured.");

    /// <summary>Rebuilds Identity's API confirmation link (HTML-encoded) as <c>{WebOrigin}/confirm-email?userId=…&amp;code=…</c>.</summary>
    public Task SendConfirmationLinkAsync(User user, string email, string confirmationLink)
    {
        var query = QueryHelpers.ParseQuery(new Uri(WebUtility.HtmlDecode(confirmationLink)).Query);
        var link = $"{Origin}/confirm-email?userId={Uri.EscapeDataString(query["userId"].ToString())}&code={Uri.EscapeDataString(query["code"].ToString())}";
        return Send(user.Email ?? email, "Confirm your Ember email address",
            $"Welcome to Ember.\n\nPlease confirm your email address by opening this link:\n{link}\n\nIf you didn't create an Ember account, you can ignore this email.");
    }

    public Task SendPasswordResetCodeAsync(User user, string email, string resetCode)
    {
        var to = user.Email ?? email;
        var link = $"{Origin}/reset-password?email={Uri.EscapeDataString(to)}&code={Uri.EscapeDataString(WebUtility.HtmlDecode(resetCode))}";
        return Send(to, "Reset your Ember password",
            $"Someone asked to reset the password of your Ember account.\n\nChoose a new password here:\n{link}\n\nIf this wasn't you, you can ignore this email; your password stays the same.");
    }

    /// <summary>Not used: the Identity API endpoints send reset codes (<see cref="SendPasswordResetCodeAsync"/>).</summary>
    public Task SendPasswordResetLinkAsync(User user, string email, string resetLink)
        => throw new NotSupportedException();

    /// <summary>Sent instead of a confirmation when someone registers with an address that already has an account.</summary>
    public Task SendAlreadyRegisteredAsync(string email)
        => Send(email, "Your Ember account",
            $"Someone tried to create an Ember account with this email address, but it already has one.\n\nSign in: {Origin}/login\nForgot your password? {Origin}/forgot-password\n\nIf this wasn't you, you can ignore this email.");

    /// <summary>
    /// Hands the email off in the background, so every mail-sending endpoint answers at the same speed and an SMTP failure
    /// never reaches the response (either would reveal whether an account exists). Failures are logged without the address.
    /// </summary>
    private Task Send(string to, string subject, string body)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await transport.SendAsync(to, subject, body, CancellationToken.None);
            }
            catch (Exception e)
            {
                logger.LogError("Sending \"{Subject}\" to a {Domain} address failed: {ExceptionType}",
                    subject, to[(to.LastIndexOf('@') + 1)..], e.GetType().Name);
            }
        });
        return Task.CompletedTask;
    }
}
