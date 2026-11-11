using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using Ember.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace Ember.Core.Services;

/// <summary>One-time "Done" tokens for web push reminders (<see cref="ReminderActionToken"/>).</summary>
public partial class HabitService
{
    /// <summary>
    /// Bot only: creates a random 256-bit token (base64url) that checks in <paramref name="habitId"/> for the local
    /// <paramref name="day"/> once, until <paramref name="expiresLocal"/> on the user's wall clock. Stores only its hash.
    /// </summary>
    public async Task<string> CreateReminderActionTokenAsync(Guid userId, int habitId, DateOnly day, DateTime expiresLocal,
        CancellationToken cancellationToken = default)
    {
        var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        var tz = await GetUserTzAsync(userId);
        _db.ReminderActionTokens.Add(new ReminderActionToken
        {
            TokenHash = ReminderActionTokenHash(token),
            UserId = userId,
            HabitId = habitId,
            Day = day,
            ExpiresUtc = TimezoneHelper.LocalToUtc(expiresLocal, tz),
        });
        await _db.SaveChangesAsync(cancellationToken);
        return token;
    }

    /// <summary>
    /// Uses a reminder action token: adds one check-in (capped at the habit's times per day) to its habit and day by the same
    /// rules as <see cref="AddCheckInAsync"/>, at most once. A token already used answers <see cref="ReminderActionResult.Logged"/>
    /// without writing; an unknown one <see cref="ReminderActionResult.Unknown"/>, an expired one
    /// <see cref="ReminderActionResult.Expired"/>. When nothing is written (no consent, a rejected or failed write) the token
    /// stays unused.
    /// </summary>
    public async Task<ReminderActionResult> UseReminderActionTokenAsync(string token, CancellationToken cancellationToken = default)
    {
        var hash = ReminderActionTokenHash(token);
        var row = await _db.ReminderActionTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
        if (row is null) return ReminderActionResult.Unknown;
        if (row.UsedUtc is not null) return ReminderActionResult.Logged;

        var now = _time.GetUtcNow().UtcDateTime;
        if (row.ExpiresUtc <= now) return ReminderActionResult.Expired;
        if (!await HasHealthDataConsentAsync(row.UserId)) return ReminderActionResult.ConsentRequired;

        var claimed = await _db.ReminderActionTokens
            .Where(t => t.Id == row.Id && t.UsedUtc == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedUtc, now), cancellationToken);
        if (claimed == 0) return ReminderActionResult.Logged;

        DayEditResult result;
        try
        {
            result = await AddCheckInAsync(row.UserId, row.HabitId, row.Day);
        }
        catch
        {
            await ReleaseReminderActionTokenAsync(row.Id);
            throw;
        }
        if (result != DayEditResult.Saved) await ReleaseReminderActionTokenAsync(row.Id);

        return result switch
        {
            DayEditResult.Saved => ReminderActionResult.Logged,
            DayEditResult.HabitNotFound => ReminderActionResult.Unknown,
            DayEditResult.ConsentRequired => ReminderActionResult.ConsentRequired,
            _ => ReminderActionResult.Expired,
        };
    }

    /// <summary>Deletes every expired reminder action token. Returns how many were deleted.</summary>
    public Task<int> DeleteExpiredReminderActionTokensAsync(CancellationToken cancellationToken = default)
    {
        var now = _time.GetUtcNow().UtcDateTime;
        return _db.ReminderActionTokens.Where(t => t.ExpiresUtc <= now).ExecuteDeleteAsync(cancellationToken);
    }

    private Task ReleaseReminderActionTokenAsync(int id)
        => _db.ReminderActionTokens.Where(t => t.Id == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedUtc, (DateTime?)null));

    private static byte[] ReminderActionTokenHash(string token) => SHA256.HashData(Encoding.UTF8.GetBytes(token));
}
