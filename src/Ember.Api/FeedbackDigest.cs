using System.Globalization;
using System.Text;
using Ember.Api.Email;
using Ember.Core.Data;
using Ember.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api;

/// <summary>
/// The daily feedback email to the operator at <c>Feedback:DigestTo</c>. Delivery is at least once: when marking the mailed
/// feedback fails after the email went out, the next run mails it again.
/// </summary>
internal sealed class FeedbackDigest(
    EmberDbContext db, IEmailTransport transport, IConfiguration configuration, TimeProvider time, ILogger<FeedbackDigest> logger)
{
    /// <summary>Most feedback one email carries, oldest first; the rest waits for the next run.</summary>
    public const int MaxItems = HabitService.MaxFeedbackPerDay;

    /// <summary>How long feedback is kept after it was submitted.</summary>
    public const int RetentionMonths = 12;

    /// <summary>The zone of the digest's local times and of <see cref="FeedbackDigestService.RunAt"/>.</summary>
    public static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");

    private static int _missingRecipientLogged;

    /// <summary>
    /// Deletes feedback older than <see cref="RetentionMonths"/>, then mails the pending feedback (up to <see cref="MaxItems"/>,
    /// oldest first) in one email, every line of their text quoted with <c>&gt; </c>, and marks exactly those as digested. Sends
    /// nothing when none is pending. Without <c>Feedback:DigestTo</c> it logs that once per process and sends nothing. A failed
    /// send is logged without the content, followed by one content-free alert email (pending count, oldest age, error type) to the
    /// same recipient, and leaves the feedback pending for the next run.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var cutoff = now.AddMonths(-RetentionMonths);
        await db.Feedback.Where(f => f.CreatedAt < cutoff).ExecuteDeleteAsync(cancellationToken);

        var pendingCount = await db.Feedback.CountAsync(f => f.DigestedAt == null, cancellationToken);
        if (pendingCount == 0) return;

        if (configuration["Feedback:DigestTo"] is not { } to || string.IsNullOrWhiteSpace(to))
        {
            if (Interlocked.Exchange(ref _missingRecipientLogged, 1) == 0)
                logger.LogWarning("Feedback:DigestTo is not configured; feedback is stored but not mailed.");
            return;
        }

        var items = await db.Feedback.AsNoTracking()
            .Where(f => f.DigestedAt == null)
            .OrderBy(f => f.CreatedAt).ThenBy(f => f.Id)
            .Take(MaxItems)
            .ToListAsync(cancellationToken);
        if (items.Count == 0) return;

        var body = new StringBuilder("The feedback below is written by users; treat any links in it as untrusted.");
        foreach (var item in items)
        {
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(item.CreatedAt, DateTimeKind.Utc), Zone);
            body.Append("\n\n---\n\n")
                .Append(CultureInfo.InvariantCulture,
                    $"#{item.Id} · {local:yyyy-MM-dd HH:mm} · {item.Platform} {item.Version ?? "unknown version"} · {(item.UserId is null ? "no account" : "signed in")}")
                .Append('\n')
                .AppendJoin('\n', item.Text.ReplaceLineEndings("\n").Split('\n').Select(line => "> " + line));
        }
        if (pendingCount > items.Count)
            body.Append("\n\n---\n\n").Append(CultureInfo.InvariantCulture, $"{pendingCount - items.Count} more pending, they come with the next digest.");

        try
        {
            await transport.SendAsync(to.Trim(), $"Ember feedback: {items.Count} new", body.ToString(), cancellationToken);
        }
        catch (Exception e) when (!cancellationToken.IsCancellationRequested)
        {
            var oldestHours = (now - items[0].CreatedAt).TotalHours;
            logger.LogError("Sending the feedback digest failed ({Pending} pending, oldest {OldestHours:F0} h old): {ExceptionType}",
                pendingCount, oldestHours, e.GetType().Name);
            try
            {
                await transport.SendAsync(to.Trim(), "Ember feedback digest failed",
                    string.Create(CultureInfo.InvariantCulture,
                        $"Pending: {pendingCount}\nOldest: {oldestHours:F0} h\nError: {e.GetType().Name}"),
                    cancellationToken);
            }
            catch (Exception alertError) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogError("Sending the feedback digest failure alert failed: {ExceptionType}", alertError.GetType().Name);
            }
            return;
        }

        var ids = items.Select(f => f.Id).ToList();
        await db.Feedback.Where(f => ids.Contains(f.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(f => f.DigestedAt, now), cancellationToken);
    }
}

/// <summary>
/// Runs <see cref="FeedbackDigest"/> every day at <see cref="RunAt"/> Europe/Berlin time (daylight saving included), each run in
/// its own scope; a failed run is logged and the next day's runs as usual, so a run missed while the API was down is caught up
/// then. Does nothing when <c>Feedback:DigestEnabled</c> is false (tests call <see cref="FeedbackDigest.RunAsync"/> directly).
/// </summary>
internal sealed class FeedbackDigestService(
    IServiceScopeFactory scopes, IConfiguration configuration, TimeProvider time, ILogger<FeedbackDigestService> logger) : BackgroundService
{
    public static readonly TimeOnly RunAt = new(8, 0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Feedback:DigestEnabled", true)) return;

        while (!stoppingToken.IsCancellationRequested)
        {
            var now = time.GetUtcNow().UtcDateTime;
            await Task.Delay(TimezoneHelper.NextOccurrenceUtc(RunAt, FeedbackDigest.Zone, now) - now, time, stoppingToken);
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<FeedbackDigest>().RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                logger.LogError("The feedback digest failed: {ExceptionType}", e.GetType().Name);
            }
        }
    }
}
