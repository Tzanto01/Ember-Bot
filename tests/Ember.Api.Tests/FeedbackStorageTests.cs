using System.Net;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class FeedbackStorageTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private Task<List<Ember.Core.Models.Feedback>> Stored()
        => Host.Db(db => db.Feedback.AsNoTracking().ToListAsync());

    [DockerFact]
    public async Task Saving_for_a_user_id_that_no_longer_exists_stores_the_feedback_without_a_user()
    {
        await Host.Run(s => s.SaveFeedbackAsync(Guid.NewGuid(), "web", "1.0", "from a deleted account"));

        var item = (await Stored()).Should().ContainSingle().Subject;
        (item.UserId, item.Text).Should().Be(((Guid?)null, "from a deleted account"));
    }

    [DockerFact]
    public async Task Saving_for_an_existing_user_keeps_the_link()
    {
        var discordUser = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(ApiHost.NewDiscordId()));

        await Host.Run(s => s.SaveFeedbackAsync(discordUser, "discord", null, "hello"));

        var item = (await Stored()).Should().ContainSingle().Subject;
        (item.UserId, item.Platform, item.Version).Should().Be((discordUser, "discord", (string?)null));
    }

    [DockerFact]
    public async Task Deleting_the_user_data_removes_the_users_feedback_and_keeps_others()
    {
        var doomed = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(ApiHost.NewDiscordId()));
        var other = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(ApiHost.NewDiscordId()));
        await Host.Run(s => s.SaveFeedbackAsync(doomed, "discord", null, "doomed"));
        await Host.Run(s => s.SaveFeedbackAsync(other, "discord", null, "other"));
        await Host.Run(s => s.SaveFeedbackAsync(null, "web", null, "anonymous"));

        await Host.Run(s => s.DeleteUserDataAsync(doomed));

        (await Stored()).Select(f => f.Text).Should().BeEquivalentTo("other", "anonymous");
    }

    [DockerFact]
    public async Task Merging_a_bot_account_moves_its_feedback_to_the_target_account()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var discordId = ApiHost.NewDiscordId();
        var botUser = await Host.Service(s => s.ResolveOrCreateDiscordUserAsync(discordId));
        await Host.Run(s => s.SaveFeedbackAsync(botUser, "discord", null, "from the bot"));
        await Host.Run(s => s.SaveFeedbackAsync(userId, "web", "1.0", "from the app"));
        (await Host.DiscordAsync(user, "/api/auth/discord/link", discordId)).Should().Be("/link/merge");

        await (await user.Post("/api/account/merge")).Expect(HttpStatusCode.NoContent);

        var all = await Stored();
        all.Should().HaveCount(2).And.OnlyContain(f => f.UserId == userId);
        all.Select(f => f.Text).Should().BeEquivalentTo("from the bot", "from the app");
    }

    private Task SeedRows(int count, TimeSpan age)
        => Host.Db(async db =>
        {
            var created = Host.Time.GetUtcNow().UtcDateTime - age;
            db.Feedback.AddRange(Enumerable.Range(0, count).Select(i => new Ember.Core.Models.Feedback { Platform = "web", Text = $"seed {i}", CreatedAt = created }));
            await db.SaveChangesAsync();
            return 0;
        });

    [DockerFact]
    public async Task At_300_feedback_in_the_last_24_hours_saving_refuses_and_the_api_answers_429_without_storing()
    {
        await SeedRows(300, TimeSpan.FromHours(2));

        var saved = await Host.Service(s => s.SaveFeedbackAsync(null, "discord", null, "one too many"));
        var response = await Host.NewClient().Post("/api/feedback", new { text = "one too many", platform = "web" });

        saved.Should().BeFalse();
        await response.ExpectProblem((HttpStatusCode)429, "rate_limited");
        (await Stored()).Should().HaveCount(300).And.NotContain(f => f.Text == "one too many");
    }

    [DockerFact]
    public async Task Feedback_older_than_24_hours_does_not_count_toward_the_cap()
    {
        await SeedRows(300, TimeSpan.FromHours(25));

        var saved = await Host.Service(s => s.SaveFeedbackAsync(null, "discord", null, "fine"));

        saved.Should().BeTrue();
        (await Stored()).Should().HaveCount(301);
    }

    [DockerFact]
    public async Task Just_under_the_cap_saving_still_works()
    {
        await SeedRows(299, TimeSpan.FromHours(2));

        (await Host.Service(s => s.SaveFeedbackAsync(null, "discord", null, "last one"))).Should().BeTrue();
    }
}
