using System.Text.RegularExpressions;
using Ember.Api.Email;

namespace Ember.Api.TestHost;

/// <summary>Captures every email instead of sending it. Thread-safe.</summary>
public sealed partial class OutboxEmailTransport : IEmailTransport
{
    /// <summary>One captured email; <see cref="Links"/> are the http(s) URLs in the body, in order.</summary>
    public sealed record Email(string To, string Subject, string Body, IReadOnlyList<string> Links);

    private readonly Lock _lock = new();
    private readonly List<Email> _emails = [];

    /// <summary>Every captured email, oldest first.</summary>
    public IReadOnlyList<Email> All
    {
        get { lock (_lock) return [.. _emails]; }
    }

    /// <summary>The latest email to <paramref name="address"/> (case-insensitive), or null when there is none.</summary>
    public Email? Latest(string address)
    {
        lock (_lock) return _emails.LastOrDefault(e => string.Equals(e.To, address, StringComparison.OrdinalIgnoreCase));
    }

    public Task SendAsync(string to, string subject, string textBody, CancellationToken cancellationToken)
    {
        var email = new Email(to, subject, textBody, [.. LinkPattern().Matches(textBody).Select(m => m.Value)]);
        lock (_lock) _emails.Add(email);
        return Task.CompletedTask;
    }

    [GeneratedRegex(@"https?://[^\s<>""]+")]
    private static partial Regex LinkPattern();
}
