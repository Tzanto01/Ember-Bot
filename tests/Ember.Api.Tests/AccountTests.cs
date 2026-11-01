using System.Net;
using Ember.Core.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

[Collection("Postgres")]
public class AccountTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    [DockerFact]
    public async Task Deleting_the_account_with_a_wrong_password_deletes_nothing()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        await user.CreateHabitAsync();

        var problem = await (await user.Post("/api/me/delete", new DeleteRequest("wrong-passphrase-1", "DELETE"))).ExpectProblem(HttpStatusCode.BadRequest, "validation");

        problem.GetProperty("errors").Has("password").Should().BeTrue();
        (await Host.Db(db => db.Users.CountAsync(u => u.Id == userId))).Should().Be(1);
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == userId))).Should().Be(1);
        (await user.Get("/api/me")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [DockerFact]
    public async Task Deleting_the_account_with_the_right_password_removes_all_data_and_the_session()
    {
        var user = await Host.SignedInAsync();
        var userId = await user.IdAsync();
        var habitId = (await user.CreateHabitAsync()).GetProperty("id").GetInt32();
        var today = Host.Today.Iso();
        await (await user.Put($"/api/habits/{habitId}/days/{today}", new { completed = true })).ExpectJson();
        await (await user.Put($"/api/low-days/{today}")).Expect(HttpStatusCode.NoContent);
        await Host.Db(async db =>
        {
            db.UserLogins.Add(new IdentityUserLogin<Guid>
            {
                LoginProvider = DiscordLogin.Provider,
                ProviderKey = DiscordLogin.Key((ulong)Random.Shared.NextInt64(1_000_000_000, long.MaxValue)),
                ProviderDisplayName = DiscordLogin.Provider,
                UserId = userId,
            });
            return await db.SaveChangesAsync();
        });
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == userId))).Should().Be(1);
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.HabitId == habitId))).Should().Be(1);
        (await Host.Db(db => db.DayMarks.CountAsync(m => m.UserId == userId))).Should().Be(1);
        (await Host.Db(db => db.UserLogins.CountAsync(l => l.UserId == userId))).Should().Be(1);

        await (await user.Post("/api/me/delete", new DeleteRequest(ApiClient.Passphrase, "DELETE"))).Expect(HttpStatusCode.NoContent);

        await (await user.Get("/api/me")).ExpectProblem(HttpStatusCode.Unauthorized, "unauthenticated");
        (await Host.Db(db => db.Users.CountAsync(u => u.Id == userId))).Should().Be(0);
        (await Host.Db(db => db.Habits.CountAsync(h => h.UserId == userId))).Should().Be(0);
        (await Host.Db(db => db.HabitLogs.CountAsync(l => l.HabitId == habitId))).Should().Be(0);
        (await Host.Db(db => db.DayMarks.CountAsync(m => m.UserId == userId))).Should().Be(0);
        (await Host.Db(db => db.UserLogins.CountAsync(l => l.UserId == userId))).Should().Be(0);
        (await user.Post("/api/auth/login?useCookies=true", new Credentials(user.Email, ApiClient.Passphrase))).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }
}
