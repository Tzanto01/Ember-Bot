namespace Ember.Core.Services;

/// <summary>
/// Thrown when a user tries to create a habit without having agreed to the current
/// health-data consent (<see cref="HabitService.CurrentConsentPolicyVersion"/>).
/// </summary>
public sealed class ConsentRequiredException : InvalidOperationException
{
    public ConsentRequiredException()
        : base("Ember needs your OK to store habit names and check-ins before it can create a habit.")
    {
    }
}
