using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;

namespace Ember.Api.Tests;

/// <summary>Routines (contract "Features v1.6 &gt; Routines").</summary>
[Collection("Postgres")]
public class RoutineApiTests(PostgresFixture postgres) : ApiTestBase(postgres)
{
    private static async Task<int> HabitIdAsync(ApiClient user) => (await user.CreateHabitAsync()).GetProperty("id").GetInt32();

    private static int[] HabitIds(JsonElement routine)
        => routine.GetProperty("habitIds").EnumerateArray().Select(e => e.GetInt32()).ToArray();

    private static async Task<Dictionary<int, int?>> RoutineIdsByHabitAsync(ApiClient user)
        => (await (await user.Get("/api/habits")).ExpectJson()).EnumerateArray().ToDictionary(
            h => h.GetProperty("id").GetInt32(),
            h => h.GetProperty("routineId").ValueKind == JsonValueKind.Null ? (int?)null : h.GetProperty("routineId").GetInt32());

    [DockerFact]
    public async Task Create_sets_ordered_members_defaults_to_webpush_and_habits_show_their_routine()
    {
        var user = await Host.SignedInAsync();
        var a = await HabitIdAsync(user);
        var b = await HabitIdAsync(user);
        var loose = await HabitIdAsync(user);

        var response = await user.Post("/api/routines", new { name = "  Morning  ", reminderTime = "07:30", habitIds = new[] { b, a } });
        var created = await response.ExpectJson(HttpStatusCode.Created);
        var id = created.GetProperty("id").GetInt32();

        response.Headers.Location!.ToString().Should().Be($"/api/routines/{id}");
        created.GetProperty("name").GetString().Should().Be("Morning");
        created.GetProperty("reminderTime").GetString().Should().Be("07:30");
        created.GetProperty("reminderChannels").EnumerateArray().Select(c => c.GetString()).Should().Equal("webpush");
        HabitIds(created).Should().Equal(b, a);
        HabitIds((await (await user.Get("/api/routines")).ExpectJson()).EnumerateArray().Single()).Should().Equal(b, a);
        (await RoutineIdsByHabitAsync(user)).Should().BeEquivalentTo(new Dictionary<int, int?> { [a] = id, [b] = id, [loose] = null });
    }

    [DockerFact]
    public async Task Listing_a_habit_moves_it_from_its_old_routine_and_patch_removes_unlisted_members()
    {
        var user = await Host.SignedInAsync();
        var h1 = await HabitIdAsync(user);
        var h2 = await HabitIdAsync(user);
        var h3 = await HabitIdAsync(user);
        var first = (await (await user.Post("/api/routines", new { name = "First", habitIds = new[] { h1, h2 } }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();

        var second = (await (await user.Post("/api/routines", new { name = "Second", habitIds = new[] { h2, h3 } }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();

        var routines = (await (await user.Get("/api/routines")).ExpectJson()).EnumerateArray().ToList();
        HabitIds(routines[0]).Should().Equal(h1);
        HabitIds(routines[1]).Should().Equal(h2, h3);

        var patched = await (await user.Patch($"/api/routines/{second}", new { habitIds = new[] { h3 } })).ExpectJson();

        HabitIds(patched).Should().Equal(h3);
        (await RoutineIdsByHabitAsync(user)).Should().BeEquivalentTo(new Dictionary<int, int?> { [h1] = first, [h2] = null, [h3] = second });
    }

    [DockerFact]
    public async Task Delete_keeps_the_habits_ungrouped()
    {
        var user = await Host.SignedInAsync();
        var habit = await HabitIdAsync(user);
        var id = (await (await user.Post("/api/routines", new { name = "Evening", habitIds = new[] { habit } }))
            .ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();

        await (await user.Delete($"/api/routines/{id}")).Expect(HttpStatusCode.NoContent);

        (await RoutineIdsByHabitAsync(user)).Should().BeEquivalentTo(new Dictionary<int, int?> { [habit] = null });
        (await (await user.Get("/api/routines")).ExpectJson()).GetArrayLength().Should().Be(0);
        await (await user.Delete($"/api/routines/{id}")).ExpectProblem(HttpStatusCode.NotFound, "not_found");
    }

    [DockerFact]
    public async Task The_eleventh_routine_is_a_conflict()
    {
        var user = await Host.SignedInAsync();
        for (var i = 0; i < 10; i++)
            await (await user.Post("/api/routines", new { name = $"Routine {i}" })).Expect(HttpStatusCode.Created);

        var problem = await (await user.Post("/api/routines", new { name = "One more" })).ExpectProblem(HttpStatusCode.Conflict, "conflict");

        problem.GetProperty("detail").GetString().Should().NotBeNullOrWhiteSpace();
        (await (await user.Get("/api/routines")).ExpectJson()).GetArrayLength().Should().Be(10);
    }

    [DockerFact]
    public async Task Foreign_or_duplicate_habit_ids_write_nothing()
    {
        var user = await Host.SignedInAsync();
        var own = await HabitIdAsync(user);
        var foreign = await HabitIdAsync(await Host.SignedInAsync());

        await (await user.Post("/api/routines", new { name = "Mixed", habitIds = new[] { own, foreign } }))
            .ExpectProblem(HttpStatusCode.NotFound, "not_found");
        (await Host.Db(db => db.Routines.CountAsync())).Should().Be(0);

        var id = (await (await user.Post("/api/routines", new { name = "Mine" })).ExpectJson(HttpStatusCode.Created)).GetProperty("id").GetInt32();
        await (await user.Patch($"/api/routines/{id}", new { name = "Renamed", habitIds = new[] { own, foreign } }))
            .ExpectProblem(HttpStatusCode.NotFound, "not_found");
        await (await user.Patch($"/api/routines/{id}", new { name = "Renamed", habitIds = new[] { own, own } }))
            .ExpectProblem(HttpStatusCode.BadRequest, "validation");

        var routine = (await (await user.Get("/api/routines")).ExpectJson()).EnumerateArray().Single();
        routine.GetProperty("name").GetString().Should().Be("Mine");
        HabitIds(routine).Should().BeEmpty();
        (await Host.Db(db => db.Habits.CountAsync(h => h.RoutineId != null))).Should().Be(0);
    }
}
