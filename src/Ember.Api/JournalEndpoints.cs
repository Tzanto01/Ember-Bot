using System.Buffers;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Ember.Core.Models;
using Ember.Core.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Ember.Api;

/// <summary>The journal for the day, own moods and the private-journal key (contract "Journal for the day", "Private journal").</summary>
internal static class JournalEndpoints
{
    public const int MaxTextLength = 2000;
    public const int MaxLabelLength = 24;
    public const int MaxEmojiLength = 32;
    public const int MaxCipherTextLength = 16384;
    public const int MaxRangeDays = 366;

    internal static readonly HashSet<string> BuiltInMoods = ["low", "meh", "okay", "good", "great"];

    public sealed record EncryptedDto(int? V, string? Iv, string? Ct);
    public sealed record DayNoteRequest(string? Text, string? Mood, EncryptedDto? Encrypted);
    public sealed record MoodRequest(string? Label, string? Emoji, EncryptedDto? Encrypted, bool? Archived);
    public sealed record PassphraseDto(string? Salt, int? Iterations, string? Iv, string? Wrapped);
    public sealed record RecoveryDto(string? Salt, string? Iv, string? Wrapped);
    public sealed record JournalKeyRequest(PassphraseDto? Passphrase, RecoveryDto? Recovery, string? Password, int? IfVersion);
    public sealed record JournalKeyDto(int Version, bool TurningOff, PassphraseDto Passphrase, RecoveryDto Recovery);
    public sealed record PasswordRequest(string? Password);
    public sealed record DeleteJournalKeyRequest(string? Password, bool? DiscardEncrypted);

    public static RouteGroupBuilder MapJournal(this RouteGroupBuilder api)
    {
        api.MapGet("/day-notes", async (string? from, string? to, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            var today = await habits.GetLocalTodayAsync(userId);
            var errors = new Dictionary<string, string[]>();
            var end = Formats.DateOr(to, today, "to", errors);
            var start = Formats.DateOr(from, Formats.DaysBefore(end, MaxRangeDays - 1), "from", errors);
            if (errors.Count == 0 && start > end) errors["from"] = ["Can't be after to."];
            if (errors.Count == 0 && end.DayNumber - start.DayNumber >= MaxRangeDays) errors["from"] = [$"At most {MaxRangeDays} days."];
            if (errors.Count > 0) return Problems.Validation(errors);

            return Results.Ok((await habits.GetDayNotesAsync(userId, start, end)).Select(ToDto).ToList());
        });

        api.MapPut("/day-notes/{date}", async (string date, DayNoteRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (!Formats.TryParseDate(date, out var day)) return Problems.Validation("date", Formats.DateMessage);

            var userId = principal.UserId();
            if (!await habits.HasHealthDataConsentAsync(userId)) return Problems.ConsentRequired();
            if (day > await habits.GetLocalTodayAsync(userId)) return Problems.DayEdit(DayEditResult.InFuture)!;
            if (await habits.GetEarliestHabitStartAsync(userId) is not { } start || day < start) return Problems.DayEdit(DayEditResult.BeforeHabitStart)!;

            var errors = new Dictionary<string, string[]>();
            var cipher = WriteForm(request.Encrypted, request.Text is not null || request.Mood is not null, true,
                await habits.GetJournalKeyAsync(userId), errors);
            string? text = null, mood = null;
            if (request.Encrypted is null)
            {
                text = ValidText(request.Text, errors);
                mood = request.Mood;
                if (mood is not null && !await IsAllowedMoodAsync(userId, day, mood, habits))
                    errors["mood"] = ["Must be low, meh, okay, good, great or one of your own active moods."];
            }
            if (errors.Count > 0) return Problems.Validation(errors);

            var note = await habits.SetDayNoteAsync(userId, day, text, mood, cipher);
            return Results.Ok(note is null ? new { date = day, text = (string?)null, mood = (string?)null } : ToDto(note));
        });

        api.MapDelete("/day-notes/{date}", async (string date, ClaimsPrincipal principal, HabitService habits) =>
        {
            if (!Formats.TryParseDate(date, out var day)) return Problems.Validation("date", Formats.DateMessage);

            await habits.DeleteDayNoteAsync(principal.UserId(), day);
            return Results.NoContent();
        });

        api.MapGet("/moods", async (ClaimsPrincipal principal, HabitService habits) =>
            (await habits.GetMoodsAsync(principal.UserId())).Select(ToDto).ToList());

        api.MapPost("/moods", async (MoodRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var userId = principal.UserId();
            if (!await habits.HasHealthDataConsentAsync(userId)) return Problems.ConsentRequired();

            var errors = new Dictionary<string, string[]>();
            var cipher = WriteForm(request.Encrypted, request.Label is not null || request.Emoji is not null, true,
                await habits.GetJournalKeyAsync(userId), errors);
            string? label = null, emoji = null;
            if (request.Encrypted is null)
            {
                label = ValidLabel(request.Label, errors);
                emoji = ValidEmoji(request.Emoji, errors);
            }
            if (errors.Count > 0) return Problems.Validation(errors);

            var (result, mood) = await habits.AddMoodAsync(userId, label, emoji, cipher, request.Archived == true);
            return result == MoodWriteResult.Saved ? Results.Created($"/api/moods/{mood!.Id}", ToDto(mood)) : MoodLimit();
        });

        api.MapPatch("/moods/{id:int}", async (int id, JsonElement body, ClaimsPrincipal principal, HabitService habits) =>
        {
            MoodRequest? request;
            try
            {
                request = body.Deserialize<MoodRequest>(JsonSerializerOptions.Web);
            }
            catch (JsonException)
            {
                request = null;
            }
            if (request is null) return Problems.Validation("body", "Must be a JSON object with label, emoji, archived or encrypted.");
            var emojiGiven = body.EnumerateObject().Any(p => string.Equals(p.Name, "emoji", StringComparison.OrdinalIgnoreCase));

            var userId = principal.UserId();
            if (!await habits.HasHealthDataConsentAsync(userId)) return Problems.ConsentRequired();
            if (await habits.GetMoodAsync(userId, id) is not { } existing) return Problems.NotFound();

            var errors = new Dictionary<string, string[]>();
            var plaintextGiven = request.Label is not null || emojiGiven;
            var cipher = WriteForm(request.Encrypted, plaintextGiven, plaintextGiven, await habits.GetJournalKeyAsync(userId), errors);
            string? label = null, emoji = null;
            if (request.Encrypted is null && plaintextGiven)
            {
                label = request.Label is null ? existing.Label : ValidLabel(request.Label, errors);
                if (label is null && !errors.ContainsKey("label")) errors["label"] = ["Required while the mood is stored encrypted."];
                emoji = emojiGiven ? ValidEmoji(request.Emoji, errors) : existing.Emoji;
            }
            if (errors.Count > 0) return Problems.Validation(errors);

            var (result, mood) = await habits.EditMoodAsync(userId, id, label, emoji, cipher, request.Archived);
            return result switch
            {
                MoodWriteResult.Saved => Results.Ok(ToDto(mood!)),
                MoodWriteResult.LimitReached => MoodLimit(),
                _ => Problems.NotFound(),
            };
        });

        api.MapGet("/me/journal-key", async (ClaimsPrincipal principal, HabitService habits) =>
            await habits.GetJournalKeyAsync(principal.UserId()) is { } key ? Results.Ok(ToDto(key)) : Problems.NotFound());

        api.MapPut("/me/journal-key", async (JournalKeyRequest request, ClaimsPrincipal principal, UserManager<User> users,
            SignInManager<User> signIn, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            var material = ValidKey(request, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (await PasswordProblem(user, request.Password, users, signIn) is { } problem) return problem;

            return await habits.PutJournalKeyAsync(user.Id, material!, request.IfVersion) is { } key
                ? Results.Ok(ToDto(key))
                : Problems.Conflict("The journal key was changed meanwhile. Reload and try again.");
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        api.MapPost("/me/journal-key/turn-off", async (PasswordRequest? request, ClaimsPrincipal principal, UserManager<User> users,
            SignInManager<User> signIn, HabitService habits) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (await PasswordProblem(user, request?.Password, users, signIn) is { } problem) return problem;

            return await habits.TurnOffJournalAsync(user.Id) is { } key ? Results.Ok(ToDto(key)) : Problems.NotFound();
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        api.MapDelete("/me/journal-key", async ([FromBody] DeleteJournalKeyRequest? request, ClaimsPrincipal principal,
            UserManager<User> users, SignInManager<User> signIn, HabitService habits) =>
        {
            var user = await users.GetUserAsync(principal);
            if (user is null) return Problems.Unauthenticated();
            if (await PasswordProblem(user, request?.Password, users, signIn) is { } problem) return problem;

            return await habits.DeleteJournalKeyAsync(user.Id, request?.DiscardEncrypted == true)
                ? Results.NoContent()
                : Problems.Conflict("Some journal entries or moods are still encrypted. Finish turning the private journal off first.");
        }).RequireRateLimiting(RateLimits.AuthPolicy);

        return api;
    }

    private static IResult MoodLimit()
        => Problems.Conflict($"You already have {HabitService.MaxActiveMoodsPerUser} active moods. Archive one to add another.");

    /// <summary>A 400 on <c>password</c> when the account has a login password and <paramref name="password"/> isn't it (counts toward lockout), else null.</summary>
    internal static async Task<IResult?> PasswordProblem(User user, string? password, UserManager<User> users, SignInManager<User> signIn)
        => await users.HasPasswordAsync(user)
            && !(await signIn.CheckPasswordSignInAsync(user, password ?? "", lockoutOnFailure: true)).Succeeded
                ? Problems.Validation("password", "The password is not correct.")
                : null;

    /// <summary>
    /// The validated blob of an encrypted write, or null for a plaintext one. Adds an error when the form isn't allowed now:
    /// encrypted needs a key, plaintext (<paramref name="plaintextWrite"/>) is refused while a key exists and isn't turning off.
    /// </summary>
    internal static JournalCipher? WriteForm(EncryptedDto? encrypted, bool plaintextGiven, bool plaintextWrite, JournalKey? key,
        Dictionary<string, string[]> errors)
    {
        if (encrypted is null)
        {
            if (plaintextWrite && key is { TurningOff: false }) errors["encrypted"] = ["The private journal is on. Send this encrypted."];
            return null;
        }

        if (plaintextGiven) errors["encrypted"] = ["Can't be combined with plaintext fields."];
        else if (key is null) errors["encrypted"] = ["The private journal is off. Send this as plaintext."];
        else
        {
            var count = errors.Count;
            if (encrypted.V != 1) errors["encrypted.v"] = ["Must be 1."];
            ExpectBase64(encrypted.Iv, 12, "encrypted.iv", errors);
            if (encrypted.Ct is not { Length: <= MaxCipherTextLength } || Base64Length(encrypted.Ct) is not >= 16)
                errors["encrypted.ct"] = [$"Must be base64 of at least 16 bytes and at most {MaxCipherTextLength} characters."];
            if (errors.Count == count) return new JournalCipher(1, encrypted.Iv!, encrypted.Ct!);
        }
        return null;
    }

    private static async Task<bool> IsAllowedMoodAsync(Guid userId, DateOnly day, string mood, HabitService habits)
    {
        if (BuiltInMoods.Contains(mood)) return true;
        if (!TryParseCustomMood(mood, out var id)) return false;
        var stored = await habits.GetDayNoteAsync(userId, day);
        if (stored?.Mood == mood) return true;
        return await habits.GetMoodAsync(userId, id) is { CipherVersion: null } own && (!own.Archived || stored?.CipherVersion is not null);
    }

    /// <summary>The id of a <c>custom:&lt;id&gt;</c> mood key in its canonical form.</summary>
    internal static bool TryParseCustomMood(string mood, out int id)
    {
        id = 0;
        return mood.StartsWith("custom:", StringComparison.Ordinal)
            && int.TryParse(mood.AsSpan(7), NumberStyles.None, CultureInfo.InvariantCulture, out id)
            && mood == $"custom:{id}";
    }

    /// <summary>The trimmed journal text, null when empty; adds an error when it is too long.</summary>
    internal static string? ValidText(string? text, Dictionary<string, string[]> errors)
    {
        var trimmed = text?.Trim() is { Length: > 0 } t ? t : null;
        if (trimmed?.Length > MaxTextLength) errors["text"] = [$"Must be at most {MaxTextLength} characters."];
        return trimmed;
    }

    internal static string? ValidLabel(string? label, Dictionary<string, string[]> errors)
    {
        var trimmed = label?.Trim();
        if (trimmed is { Length: >= 1 and <= MaxLabelLength }) return trimmed;
        errors["label"] = [$"Must be 1 to {MaxLabelLength} characters."];
        return null;
    }

    internal static string? ValidEmoji(string? emoji, Dictionary<string, string[]> errors)
    {
        if (emoji is null || IsEmoji(emoji)) return emoji;
        errors["emoji"] = ["Must be a single emoji."];
        return null;
    }

    private static bool IsEmoji(string value)
    {
        if (value.Length is 0 or > MaxEmojiLength || new StringInfo(value).LengthInTextElements != 1) return false;
        if (value[0] is (>= '0' and <= '9') or '#' or '*' && value.EndsWith('⃣')) return true;
        return Rune.DecodeFromUtf16(value, out var first, out _) == OperationStatus.Done
            && Rune.GetUnicodeCategory(first) is UnicodeCategory.OtherSymbol or UnicodeCategory.ModifierSymbol;
    }

    internal static JournalKey? ValidKey(JournalKeyRequest request, Dictionary<string, string[]> errors)
    {
        var passphrase = request.Passphrase;
        var recovery = request.Recovery;
        ExpectBase64(passphrase?.Salt, 16, "passphrase.salt", errors);
        if (passphrase?.Iterations is not (>= 600_000 and <= 10_000_000))
            errors["passphrase.iterations"] = ["Must be between 600000 and 10000000."];
        ExpectBase64(passphrase?.Iv, 12, "passphrase.iv", errors);
        ExpectBase64(passphrase?.Wrapped, 48, "passphrase.wrapped", errors);
        ExpectBase64(recovery?.Salt, 16, "recovery.salt", errors);
        ExpectBase64(recovery?.Iv, 12, "recovery.iv", errors);
        ExpectBase64(recovery?.Wrapped, 48, "recovery.wrapped", errors);
        if (errors.Count > 0) return null;

        return new JournalKey
        {
            PassphraseSalt = passphrase!.Salt!,
            PassphraseIterations = passphrase.Iterations!.Value,
            PassphraseIv = passphrase.Iv!,
            PassphraseWrapped = passphrase.Wrapped!,
            RecoverySalt = recovery!.Salt!,
            RecoveryIv = recovery.Iv!,
            RecoveryWrapped = recovery.Wrapped!,
        };
    }

    private static void ExpectBase64(string? value, int bytes, string field, Dictionary<string, string[]> errors)
    {
        if (value?.Length != (bytes + 2) / 3 * 4 || Base64Length(value) != bytes) errors[field] = [$"Must be base64 of {bytes} bytes."];
    }

    /// <summary>The decoded length of strict (padded, no whitespace) base64, or null when it isn't.</summary>
    private static int? Base64Length(string value)
    {
        if (value.Length % 4 != 0 || value.Any(char.IsWhiteSpace)) return null;
        var bytes = new byte[value.Length / 4 * 3];
        return Convert.TryFromBase64String(value, bytes, out var written) ? written : null;
    }

    private static object ToDto(DayNote note) => note.CipherVersion is { } version
        ? new { date = note.Date, encrypted = new EncryptedDto(version, note.CipherIv, note.CipherText) }
        : new { date = note.Date, text = note.Text, mood = note.Mood };

    private static object ToDto(Mood mood) => mood.CipherVersion is { } version
        ? new { id = mood.Id, encrypted = new EncryptedDto(version, mood.CipherIv, mood.CipherText), archived = mood.Archived }
        : new { id = mood.Id, label = mood.Label, emoji = mood.Emoji, archived = mood.Archived };

    private static JournalKeyDto ToDto(JournalKey key) => new(
        key.Version, key.TurningOff,
        new PassphraseDto(key.PassphraseSalt, key.PassphraseIterations, key.PassphraseIv, key.PassphraseWrapped),
        new RecoveryDto(key.RecoverySalt, key.RecoveryIv, key.RecoveryWrapped));
}
