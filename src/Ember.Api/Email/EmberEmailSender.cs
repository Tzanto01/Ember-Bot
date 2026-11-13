using System.Globalization;
using System.Net;
using System.Resources;
using System.Security.Cryptography;
using System.Text;
using Ember.Core.Data;
using Ember.Core.Localization;
using Ember.Core.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Email;

/// <summary>
/// Identity's account emails, with links into the web app at <c>Ember:WebOrigin</c> (never the request host), in the account's
/// <see cref="User.Language"/>.
/// </summary>
internal sealed class EmberEmailSender(
    IEmailTransport transport, IConfiguration configuration, TimeProvider time, IServiceScopeFactory scopes,
    IHttpContextAccessor http, ILogger<EmberEmailSender> logger)
    : IEmailSender<User>
{
    /// <summary>The wait before the one retry of a transient failure.</summary>
    internal static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(30);

    /// <summary>How long an emailed sign-up code works.</summary>
    internal static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(15);

    /// <summary>Tries (right or wrong) a sign-up code allows.</summary>
    internal const int CodeTries = 5;

    /// <summary>The email texts in <c>Resources/Email.resx</c>.</summary>
    internal static readonly ResourceManager EmailResources = new("Ember.Api.Resources.Email", typeof(EmberEmailSender).Assembly);

    private static Texts TextsFor(string language) => new(language, EmailResources, Texts.CoreResources);

    private string Origin => ApiApp.WebOrigin(configuration)
        ?? throw new InvalidOperationException("Ember:WebOrigin is not configured.");

    /// <summary>The stored form of a sign-up code: SHA-256, upper-case hex.</summary>
    internal static string CodeHash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));

    /// <summary>The header that carries the sign-up key of the device asking for a code.</summary>
    internal const string SignupKeyHeader = "X-Ember-Signup-Key";

    /// <summary>The stored form of a sign-up key (see <see cref="CodeHash"/>); null for none or a malformed one (empty, over 128 characters, not base64url).</summary>
    internal static string? KeyHash(string? key)
        => key is { Length: > 0 and <= 128 } && key.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_') ? CodeHash(key) : null;

    /// <summary>
    /// Ignores Identity's link: mails a new 6-digit sign-up code (replacing any earlier one, valid for <see cref="CodeLifetime"/>)
    /// and the link <c>{WebOrigin}/confirm-email?user=…&amp;code=…</c>. The code's hash is stored before the mail goes out, only while the email is unconfirmed. Only sign-up binds the code to the
    /// request's <see cref="SignupKeyHeader"/>; a resend keeps that binding when it sends the same key and drops it otherwise, so a
    /// resend can never tie a code to another device.
    /// </summary>
    public Task SendConfirmationLinkAsync(User user, string email, string confirmationLink)
    {
        var code = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var hash = CodeHash(code);
        var keyHash = KeyHash(http.HttpContext?.Request.Headers[SignupKeyHeader].ToString());
        var signingUp = http.HttpContext?.Request.Path.Value?.EndsWith("/register", StringComparison.OrdinalIgnoreCase) == true;
        var expires = (time.GetUtcNow() + CodeLifetime).UtcDateTime;
        var userId = user.Id;
        var link = $"{Origin}/confirm-email?user={userId}&code={code}";
        var t = TextsFor(user.Language);
        return Send(user.Email ?? email, t.Get("email.confirm.subject"), t.Format("email.confirm.body", code, link),
            async () =>
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<EmberDbContext>().Users.Where(u => u.Id == userId && !u.EmailConfirmed)
                    .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailCodeHash, hash).SetProperty(u => u.EmailCodeExpiresAt, expires)
                        .SetProperty(u => u.EmailCodeKeyHash, u => signingUp || u.EmailCodeKeyHash == keyHash ? keyHash : null)
                        .SetProperty(u => u.EmailCodeTries, 0));
            });
    }

    public Task SendPasswordResetCodeAsync(User user, string email, string resetCode)
    {
        var to = user.Email ?? email;
        var link = $"{Origin}/reset-password?email={Uri.EscapeDataString(to)}&code={Uri.EscapeDataString(WebUtility.HtmlDecode(resetCode))}";
        var t = TextsFor(user.Language);
        return Send(to, t.Get("email.reset.subject"), t.Format("email.reset.body", link));
    }

    /// <summary>Not used: the Identity API endpoints send reset codes (<see cref="SendPasswordResetCodeAsync"/>).</summary>
    public Task SendPasswordResetLinkAsync(User user, string email, string resetLink)
        => throw new NotSupportedException();

    /// <summary>Sent instead of a confirmation when someone registers with an address that already has an account.</summary>
    /// <param name="email">The account's address.</param>
    /// <param name="language">The account's <see cref="User.Language"/>.</param>
    public Task SendAlreadyRegisteredAsync(string email, string language)
    {
        var t = TextsFor(language);
        return Send(email, t.Get("email.registered.subject"), t.Format("email.registered.body", $"{Origin}/login", $"{Origin}/forgot-password"));
    }

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
