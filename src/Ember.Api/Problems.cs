using Ember.Core.Services;

namespace Ember.Api;

/// <summary>Every problem response of the API, with the contract's <c>type</c> codes.</summary>
internal static class Problems
{
    private static readonly HashSet<string> Codes =
    [
        "validation", "unauthenticated", "forbidden", "consent_required", "antiforgery", "not_found",
        "habit_limit", "conflict", "before_habit_start", "in_future", "rate_limited", "internal",
        "invalid_code", "password_required",
    ];

    /// <summary>
    /// Gives every problem written by the framework (status code pages, exception handler, Identity endpoints)
    /// a contract code matching its status, and drops any detail from server errors.
    /// </summary>
    public static void Customize(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        var status = problem.Status ?? context.HttpContext.Response.StatusCode;
        if (problem.Type is null || !Codes.Contains(problem.Type))
        {
            problem.Type = status switch
            {
                400 => "validation",
                401 => "unauthenticated",
                403 => "forbidden",
                404 => "not_found",
                409 => "conflict",
                429 => "rate_limited",
                500 => "internal",
                _ => problem.Type,
            };
        }

        if (status >= 500)
        {
            problem.Detail = null;
            problem.Extensions.Remove("exception");
        }
    }

    public static IResult Validation(IDictionary<string, string[]> errors) => TypedResults.ValidationProblem(errors, type: "validation");

    public static IResult Validation(string field, string message) => Validation(new Dictionary<string, string[]> { [field] = [message] });

    public static IResult Unauthenticated() => Problem(StatusCodes.Status401Unauthorized, "unauthenticated");

    /// <summary>Every failure of an emailed sign-up code, whatever the reason, so the answer reveals nothing about the account.</summary>
    public static IResult InvalidCode() => Problem(StatusCodes.Status401Unauthorized, "invalid_code",
        "That code didn't work. Check the newest email or send a new code.");

    /// <summary>A valid sign-up code entered on another device than the one that asked for it, without the password.</summary>
    public static IResult PasswordRequired() => Problem(StatusCodes.Status401Unauthorized, "password_required",
        "Enter your password to finish on this device.");

    public static IResult ConsentRequired() => Problem(StatusCodes.Status403Forbidden, "consent_required");

    public static IResult Antiforgery() => Problem(StatusCodes.Status403Forbidden, "antiforgery");

    public static IResult NotFound() => Problem(StatusCodes.Status404NotFound, "not_found");

    public static IResult Expired() => Problem(StatusCodes.Status410Gone, "expired");

    public static IResult HabitLimit() => Problem(StatusCodes.Status409Conflict, "habit_limit");

    /// <param name="detail">Short user-facing reason.</param>
    public static IResult Conflict(string detail) => Problem(StatusCodes.Status409Conflict, "conflict", detail);

    public static IResult RateLimited() => Problem(StatusCodes.Status429TooManyRequests, "rate_limited");

    /// <summary>The problem for a day edit that wasn't saved; null for <see cref="DayEditResult.Saved"/>.</summary>
    public static IResult? DayEdit(DayEditResult result) => result switch
    {
        DayEditResult.Saved => null,
        DayEditResult.HabitNotFound => NotFound(),
        DayEditResult.BeforeHabitStart => Problem(StatusCodes.Status422UnprocessableEntity, "before_habit_start"),
        DayEditResult.InFuture => Problem(StatusCodes.Status422UnprocessableEntity, "in_future"),
        DayEditResult.ConsentRequired => ConsentRequired(),
        _ => throw new ArgumentOutOfRangeException(nameof(result), result, null),
    };

    private static IResult Problem(int status, string type, string? detail = null)
        => TypedResults.Problem(statusCode: status, type: type, detail: detail);
}
