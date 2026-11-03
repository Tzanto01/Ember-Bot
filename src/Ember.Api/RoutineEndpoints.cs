using System.Security.Claims;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Routines: named, ordered groups of habits with an optional shared reminder.</summary>
internal static class RoutineEndpoints
{
    public const int MaxNameLength = 50;

    public sealed record RoutineDto(int Id, string Name, string? ReminderTime, List<string> ReminderChannels, List<int> HabitIds);

    public sealed record CreateRoutineRequest(string? Name, string? ReminderTime, string?[]? ReminderChannels, int[]? HabitIds);
    public sealed record UpdateRoutineRequest(string? Name, string? ReminderTime, bool? ClearReminder, string?[]? ReminderChannels,
        int[]? HabitIds);

    public static RouteGroupBuilder MapRoutines(this RouteGroupBuilder api)
    {
        api.MapGet("/routines", async (ClaimsPrincipal principal, HabitService habits) =>
            (await habits.GetRoutinesAsync(principal.UserId())).Select(ToDto).ToList());

        api.MapPost("/routines", async (CreateRoutineRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            var name = HabitEndpoints.ValidName(request.Name, errors, MaxNameLength);
            var reminder = HabitEndpoints.ParseReminder(request.ReminderTime, errors);
            var channels = HabitEndpoints.ParseReminderChannels(request.ReminderChannels, errors);
            ValidateHabitIds(request.HabitIds, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var (result, routine) = await habits.AddRoutineAsync(principal.UserId(), name!, reminder,
                channels ?? ReminderChannels.WebPush, request.HabitIds);
            return result switch
            {
                RoutineWriteResult.Saved => Results.Created($"/api/routines/{routine!.Id}", ToDto(routine)),
                RoutineWriteResult.LimitReached => Problems.Conflict(
                    $"You already have {HabitService.MaxRoutinesPerUser} routines, the most Ember can hold. Delete one to add another."),
                _ => Problems.NotFound(),
            };
        });

        api.MapPatch("/routines/{id:int}", async (int id, UpdateRoutineRequest request, ClaimsPrincipal principal, HabitService habits) =>
        {
            var errors = new Dictionary<string, string[]>();
            var name = request.Name is null ? null : HabitEndpoints.ValidName(request.Name, errors, MaxNameLength);
            var reminder = HabitEndpoints.ParseReminder(request.ReminderTime, errors);
            if (request.ReminderTime is not null && request.ClearReminder == true)
                errors["reminderTime"] = ["Can't be combined with clearReminder."];
            var channels = HabitEndpoints.ParseReminderChannels(request.ReminderChannels, errors);
            ValidateHabitIds(request.HabitIds, errors);
            if (errors.Count > 0) return Problems.Validation(errors);

            var userId = principal.UserId();
            if (await habits.EditRoutineAsync(userId, id, name, reminder, request.ClearReminder == true, channels, request.HabitIds)
                != RoutineWriteResult.Saved)
                return Problems.NotFound();

            return (await habits.GetRoutinesAsync(userId)).FirstOrDefault(r => r.Id == id) is { } routine
                ? Results.Ok(ToDto(routine))
                : Problems.NotFound();
        });

        api.MapDelete("/routines/{id:int}", async (int id, ClaimsPrincipal principal, HabitService habits) =>
            await habits.DeleteRoutineAsync(principal.UserId(), id) ? Results.NoContent() : Problems.NotFound());

        return api;
    }

    private static void ValidateHabitIds(int[]? habitIds, Dictionary<string, string[]> errors)
    {
        if (habitIds is not null && habitIds.Distinct().Count() != habitIds.Length)
            errors["habitIds"] = ["Each habit can be listed once."];
    }

    private static RoutineDto ToDto(Routine routine) => new(
        routine.Id, routine.Name,
        routine.ReminderTime is { } time ? Formats.Time(time) : null,
        HabitService.ReminderChannelNames(routine.ReminderChannels),
        routine.Habits.OrderBy(h => h.RoutinePosition).Select(h => h.Id).ToList());
}
