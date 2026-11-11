using System.Net;
using System.Text.Json;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class MergeTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private const string MergeUrl = "/api/account/merge";

    /// <summary>A bot-only user with consent, one habit per name (each checked in today) and low days on the given offsets from today.</summary>
    private async Task<(Guid UserId, ulong DiscordId)> BotOnlyAsync(string[] habitNames, params int[] lowDayOffsets)
    {
        var discordId = ApiHost.NewDiscordId();
        var userId = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        await Host.Run(s => s.GiveHealthDataConsentAsync(userId));
        foreach (var name in habitNames)
        {
            var habit = await Host.Service(s => s.AddHabitAsync(userId, name, null));
            await Host.Run(s => s.CheckInAsync(userId, habit.Id, Host.Today, true));
        }
        foreach (var offset in lowDayOffsets)
            await Host.Run(s => s.SetLowDayAsync(userId, Host.Today.AddDays(offset)));
        return (userId, discordId);
    }

    private async Task StartMergeAsync(ApiClient user, ulong botDiscordId)
        => (await Host.DiscordAsync(user, "/api/auth/discord/link", botDiscordId)).Should().Be("/link/merge");

    private Task<bool> UserExists(Guid id) => Host.Db(db => db.Users.AnyAsync(u => u.Id == id));

    [DockerFact]
    public async Task Merging_ends_the_bot_accounts_sessions_at_once()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync([]);
        var botDevice = Host.NewClient();
        await Host.DiscordAsync(botDevice, "/api/auth/discord/login", bot.DiscordId);
        await (await botDevice.Get("/api/me")).Expect(HttpStatusCode.OK);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await Host.SessionIsLiveAsync(botDevice)).Should().BeFalse();
    }

    [DockerFact]
    public async Task Preview_counts_what_would_move_and_shows_the_signed_in_accounts_settings()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { graceDaysPerWeek = 2 })).ExpectJson();
        var bot = await BotOnlyAsync(["Water", "Read"], 0);
        await StartMergeAsync(user, bot.DiscordId);

        var preview = await (await user.Get(MergeUrl)).ExpectJson();

        preview.GetProperty("habits").GetInt32().Should().Be(2);
        preview.GetProperty("logs").GetInt32().Should().Be(2);
        preview.GetProperty("dayMarks").GetInt32().Should().Be(1);
        preview.GetProperty("habitNames").EnumerateArray().Select(n => n.GetString()).Should().Equal("Water", "Read");
        var kept = preview.GetProperty("kept");
        kept.GetProperty("graceDaysPerWeek").GetInt32().Should().Be(2);
        kept.EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("timezone", "graceDaysPerWeek");
        kept.GetProperty("timezone").GetString().Should().Be("UTC");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }

    [DockerFact]
    public async Task Merging_moves_habits_logs_and_day_marks_deletes_the_bot_user_and_points_the_login_at_the_account()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var today = Host.Today.Iso();
        var ownHabit = (await user.CreateHabitAsync("Water")).GetProperty("id").GetInt32();
        await (await user.Put($"/api/habits/{ownHabit}/days/{today}", new { completed = true })).ExpectJson();
        await (await user.Put($"/api/low-days/{today}")).Expect(HttpStatusCode.NoContent);
        var bot = await BotOnlyAsync(["Water", "Read"], 0, -1);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        var habits = await (await user.Get("/api/habits")).ExpectJson();
        habits.EnumerateArray().Select(h => h.GetProperty("name").GetString()).Should().BeEquivalentTo("Water", "Water", "Read");
        (await UserExists(bot.UserId)).Should().BeFalse();
        (await Host.Service(s => s.FindDiscordUserAsync(bot.DiscordId))).Should().Be(userId);
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.Habit.UserId == userId))).Should().Be(3);
        (await Host.Db(db => db.DayMarks.CountAsync(m => m.UserId == userId && m.Date == Host.Today))).Should().Be(1);
        (await (await user.Get("/api/low-days")).ExpectJson()).GetArrayLength().Should().Be(2);
        var me = await (await user.Get("/api/me")).ExpectJson();
        me.GetProperty("discord").GetProperty("id").GetString().Should().Be(bot.DiscordId.ToString());
        user.CookieValue("ember.merge", MergeUrl).Should().BeNull();
        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Merging_reschedules_moved_reminders_in_the_signed_in_accounts_timezone()
    {
        var user = await Host.SignedInAsync();
        await (await user.Patch("/api/me", new { timezone = "Europe/Berlin" })).ExpectJson();
        var bot = await BotOnlyAsync([]);
        var habit = await Host.Service(s => s.AddHabitAsync(bot.UserId, "Water", new TimeOnly(9, 0)));
        var before = await Host.Db(db => db.Habits.Where(h => h.Id == habit.Id).Select(h => h.NextReminderUtc).SingleAsync());
        before.Should().Be(new DateTime(2026, 11, 2, 9, 0, 0, DateTimeKind.Utc));
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        var after = await Host.Db(db => db.Habits.Where(h => h.Id == habit.Id).Select(h => h.NextReminderUtc).SingleAsync());
        after.Should().Be(new DateTime(2026, 11, 2, 8, 0, 0, DateTimeKind.Utc));
    }

    [DockerFact]
    public async Task The_habit_limit_does_not_block_a_merge()
    {
        var user = await Host.SignedInAsync();
        for (var i = 0; i < 24; i++)
            await user.CreateHabitAsync();
        var bot = await BotOnlyAsync(["Water", "Read"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(26);
    }

    [DockerFact]
    public async Task Merging_without_consent_is_refused_and_moves_nothing_until_consent_is_given()
    {
        var user = await Host.SignedInAsync(consent: false);
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Forbidden, "consent_required");

        (await UserExists(bot.UserId)).Should().BeTrue();
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == bot.UserId))).Should().Be(1);
        await user.GiveConsentAsync();
        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);
    }

    [DockerFact]
    public async Task A_pending_merge_expires_after_15_minutes()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        (await user.Get(MergeUrl)).StatusCode.Should().Be(HttpStatusCode.OK);

        Host.Time.Advance(TimeSpan.FromMinutes(16));

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }

    [DockerFact]
    public async Task A_merge_cookie_cannot_be_replayed_after_the_merge()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        var cookie = user.CookieValue("ember.merge", MergeUrl)!;
        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        user.AddCookie("ember.merge", cookie, MergeUrl);
        await user.RefreshCsrfAsync();

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task Another_users_merge_cookie_is_ignored()
    {
        var starter = await Host.SignedInAsync();
        var other = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(starter, bot.DiscordId);
        other.AddCookie("ember.merge", starter.CookieValue("ember.merge", MergeUrl)!, MergeUrl);

        await (await other.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await other.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");

        (await UserExists(bot.UserId)).Should().BeTrue();
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == bot.UserId))).Should().Be(1);
    }

    [DockerFact]
    public async Task A_source_that_changed_between_preview_and_confirm_is_a_conflict_and_nothing_moves()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        await Host.Run(s => s.DeleteUserDataAsync(bot.UserId));
        var recreated = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(bot.DiscordId));

        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        (await UserExists(recreated)).Should().BeTrue();
        (await Host.Service(s => s.FindDiscordUserAsync(bot.DiscordId))).Should().Be(recreated);
        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
    }

    [DockerFact]
    public async Task A_source_that_enabled_two_factor_after_the_preview_is_a_conflict_and_nothing_moves()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);
        await Host.Db(db => db.Users.Where(u => u.Id == bot.UserId).ExecuteUpdateAsync(s => s.SetProperty(u => u.TwoFactorEnabled, true)));

        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        (await UserExists(bot.UserId)).Should().BeTrue();
        (await (await user.Get("/api/habits")).ExpectJson()).GetArrayLength().Should().Be(0);
    }

    private Task<T> Seed<T>(T entity) where T : class => Host.Db(async db =>
    {
        db.Add(entity);
        await db.SaveChangesAsync();
        return entity;
    });

    private static JournalKey Key(Guid userId) => new()
    {
        UserId = userId, Version = 1, PassphraseSalt = "c2FsdA==", PassphraseIterations = 600000, PassphraseIv = "aXY=",
        PassphraseWrapped = "d3JhcA==", RecoverySalt = "cnNhbHQ=", RecoveryIv = "cml2", RecoveryWrapped = "cndyYXA=",
    };

    [DockerFact]
    public async Task Merging_moves_routines_moods_day_notes_and_the_journal_key_and_the_routine_limit_does_not_block()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        for (var i = 0; i < 10; i++)
            await Seed(new Routine { UserId = userId, Name = $"Own {i}" });
        var bot = await BotOnlyAsync(["Read"]);
        var routine = await Seed(new Routine { UserId = bot.UserId, Name = "Evening" });
        await Host.Db(db => db.Habits.Where(h => h.UserId == bot.UserId)
            .ExecuteUpdateAsync(u => u.SetProperty(h => h.RoutineId, routine.Id)));
        var mood = await Seed(new Mood { UserId = bot.UserId, Label = "Proud" });
        var secret = await Seed(new Mood { UserId = bot.UserId, CipherVersion = 1, CipherIv = "aXY=", CipherText = "Y3Q=" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today.AddDays(-1), Text = "A walk", Mood = $"custom:{mood.Id}" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today, CipherVersion = 1, CipherIv = "aXY=", CipherText = "Y3Q=" });
        await Seed(Key(bot.UserId));
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await Host.Db(db => db.Routines.CountAsync(r => r.UserId == userId))).Should().Be(11);
        (await Host.Db(db => db.Habits.Where(h => h.UserId == userId).Select(h => h.RoutineId).SingleAsync())).Should().Be(routine.Id);
        (await Host.Db(db => db.Moods.Where(m => m.UserId == userId).Select(m => m.Id).ToListAsync()))
            .Should().BeEquivalentTo([mood.Id, secret.Id]);
        (await Host.Db(db => db.DayNotes.Where(n => n.UserId == userId).OrderBy(n => n.Date).Select(n => n.Mood).ToListAsync()))
            .Should().Equal($"custom:{mood.Id}", null);
        (await Host.Db(db => db.JournalKeys.Where(k => k.UserId == userId).Select(k => k.PassphraseWrapped).SingleAsync()))
            .Should().Be("d3JhcA==");
        (await UserExists(bot.UserId)).Should().BeFalse();
    }

    [DockerFact]
    public async Task Merging_combines_plaintext_moods_with_the_same_label_and_points_the_moved_notes_at_the_kept_mood()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var kept = await Seed(new Mood { UserId = userId, Label = "proud ", Archived = true });
        var bot = await BotOnlyAsync([]);
        var same = await Seed(new Mood { UserId = bot.UserId, Label = " PROUD", Emoji = "🦁" });
        var other = await Seed(new Mood { UserId = bot.UserId, Label = "Calm" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today.AddDays(-2), Mood = $"custom:{same.Id}" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today.AddDays(-1), Mood = $"custom:{other.Id}" });
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        var moods = await Host.Db(db => db.Moods.Where(m => m.UserId == userId).OrderBy(m => m.Id)
            .Select(m => new { m.Id, m.Archived }).ToListAsync());
        moods.Should().BeEquivalentTo([new { kept.Id, Archived = true }, new { other.Id, Archived = false }]);
        (await Host.Db(db => db.Moods.AnyAsync(m => m.Id == same.Id))).Should().BeFalse();
        (await Host.Db(db => db.DayNotes.Where(n => n.UserId == userId).OrderBy(n => n.Date).Select(n => n.Mood).ToListAsync()))
            .Should().Equal($"custom:{kept.Id}", $"custom:{other.Id}");
    }

    [DockerFact]
    public async Task On_a_date_both_accounts_journaled_the_signed_in_accounts_entry_is_kept()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        await Seed(new DayNote { UserId = userId, Date = Host.Today.AddDays(-1), Text = "Mine" });
        var bot = await BotOnlyAsync([]);
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today.AddDays(-1), Text = "Theirs" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today.AddDays(-2), Text = "Older" });
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await Host.Db(db => db.DayNotes.Where(n => n.UserId == userId).OrderBy(n => n.Date).Select(n => n.Text).ToListAsync()))
            .Should().Equal("Older", "Mine");
    }

    [DockerFact]
    public async Task When_both_accounts_have_a_private_journal_the_merge_is_refused_and_nothing_moves()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        await Seed(Key(userId));
        var bot = await BotOnlyAsync(["Read"]);
        await Seed(new Routine { UserId = bot.UserId, Name = "Evening" });
        await Seed(new DayNote { UserId = bot.UserId, Date = Host.Today, CipherVersion = 1, CipherIv = "aXY=", CipherText = "Y3Q=" });
        await Seed(Key(bot.UserId));
        await StartMergeAsync(user, bot.DiscordId);

        var problem = await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        problem.GetProperty("detail").GetString().Should().Contain("private journal");
        (await UserExists(bot.UserId)).Should().BeTrue();
        (await Host.Service(s => s.FindDiscordUserAsync(bot.DiscordId))).Should().Be(bot.UserId);
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == bot.UserId))).Should().Be(1);
        (await Host.Db(db => db.Routines.CountAsync(r => r.UserId == bot.UserId))).Should().Be(1);
        (await Host.Db(db => db.DayNotes.CountAsync(n => n.UserId == bot.UserId))).Should().Be(1);
        (await Host.Db(db => db.JournalKeys.CountAsync(k => k.UserId == bot.UserId || k.UserId == userId))).Should().Be(2);
    }

    [DockerFact]
    public async Task Cancelling_a_pending_merge_discards_it()
    {
        var user = await Host.SignedInAsync();
        var bot = await BotOnlyAsync(["Water"]);
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Delete(MergeUrl)).Expect(HttpStatusCode.NoContent);

        await (await user.Get(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Post(MergeUrl)).ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await UserExists(bot.UserId)).Should().BeTrue();
    }

    [DockerFact]
    public async Task Merging_keeps_the_bot_accounts_open_reminder_messages_under_the_signed_in_account()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var bot = await BotOnlyAsync(["Water"]);
        var habitId = await Host.Db(db => db.Habits.Where(h => h.UserId == bot.UserId).Select(h => h.Id).SingleAsync());
        await Host.Db(db =>
        {
            db.ReminderMessages.Add(new ReminderMessage
            {
                UserId = bot.UserId, HabitId = habitId, Date = Host.Today, ChannelId = 900_001, MessageId = 900_002,
            });
            return db.SaveChangesAsync();
        });
        await StartMergeAsync(user, bot.DiscordId);

        await (await user.Post(MergeUrl)).Expect(HttpStatusCode.NoContent);

        (await Host.Db(db => db.ReminderMessages.Where(m => m.MessageId == 900_002).Select(m => m.UserId).ToListAsync()))
            .Should().Equal(userId);
    }
}
