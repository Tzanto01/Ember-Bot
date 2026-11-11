using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Ember.Core.Data;
using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Email;

/// <summary>Identity's account emails, with links into the web app at <c>Ember:WebOrigin</c> (never the request host).</summary>
internal sealed class EmberEmailSender(
    IEmailTransport transport, IConfiguration configuration, TimeProvider time, IServiceScopeFactory scopes, ILogger<EmberEmailSender> logger)
    : IEmailSender<User>
{
    /// <summary>The wait before the one retry of a transient failure.</summary>
    internal static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>How long an emailed sign-up code works.</summary>
    internal static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);

    /// <summary>Tries (right or wrong) a sign-up code allows.</summary>
    internal const int CodeTries = 5;

    private string Origin => ApiApp.WebOrigin(configuration)
        ?? throw new InvalidOperationException("Ember:WebOrigin is not configured.");

    /// <summary>The stored form of a sign-up code: SHA-256, upper-case hex.</summary>
    internal static string CodeHash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    /// <summary>
    /// Ignores Identity's link: mails a new 6-digit sign-up code (replacing any earlier one, valid for <see cref="CodeLifetime"/>)
    /// and the link <c>{WebOrigin}/confirm-email?user=…&amp;code=…</c>. The code's hash is stored before the mail goes out, only while the email is unconfirmed.
    /// </summary>
    public Task SendConfirmationLinkAsync(User user, string email, string confirmationLink)
    {
        var code = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var hash = CodeHash(code);
        var expires = (time.GetUtcNow() + CodeLifetime).UtcDateTime;
        var userId = user.Id;
        var link = $"{Origin}/confirm-email?user={userId}&code={code}";
        return Send(user.Email ?? email, "Confirm your Ember email address",
            $"Welcome to Ember.\n\nYour code:\n\n{code}\n\nEnter it in Ember to confirm your email address and sign in, or open this link:\n{link}\n\nThe code works for 15 minutes. If you didn't create an Ember account, you can ignore this email.",
            async () =>
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<EmberDbContext>().Users.Where(u => u.Id == userId && !u.EmailConfirmed)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailCodeHash, hash).SetProperty(u => u.EmailCodeExpiresAt, expires).SetProperty(u => u.EmailCodeTries, 0));
            });
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
    /// never reaches the response (either would reveal whether an account exists). A transient failure is retried once after
    /// <see cref="RetryDelay"/>. Failures are logged without the address.
    /// </summary>
    /// <param name="prepare">Runs first in the background; when it fails, nothing is sent.</param>
    private Task Send(string to, string subject, string body, Func<Task>? prepare = null)
    {
        _ = Task.Run(async () =>
        {
            var domain = to[(to.LastIndexOf('@') + 1)..];
            try
            {
                if (prepare is not null) await prepare();
            }
            catch (Exception e)
            {
                logger.LogError("Preparing \"{Subject}\" to a {Domain} address failed: {ExceptionType}", subject, domain, e.GetType().Name);
                return;
            }

            try
            {
                await transport.SendAsync(to, subject, body, CancellationToken.None);
                return;
            }
            catch (Exception e) when (SmtpEmailTransport.IsTransient(e))
            {
                logger.LogWarning("Sending \"{Subject}\" to a {Domain} address failed, retrying: {ExceptionType}", subject, domain, e.GetType().Name);
            }
            catch (Exception e)
            {
                logger.LogError("Sending \"{Subject}\" to a {Domain} address failed: {ExceptionType}", subject, domain, e.GetType().Name);
                return;
            }

            try
            {
                await Task.Delay(RetryDelay, time);
                await transport.SendAsync(to, subject, body, CancellationToken.None);
            }
            catch (Exception e)
            {
                logger.LogError("Sending \"{Subject}\" to a {Domain} address failed: {ExceptionType}", subject, domain, e.GetType().Name);
            }
        });
        return Task.CompletedTask;
    }
}
