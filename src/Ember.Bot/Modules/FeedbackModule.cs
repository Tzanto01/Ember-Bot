using Discord;
using Discord.Interactions;
using Ember.Bot.Services;
using Ember.Core.Localization;
using Ember.Core.Models;
using Ember.Core.Services;

namespace Ember.Bot.Modules;

/// <summary>
/// <c>/feedback</c>: a modal with a title, a description, up to <see cref="FeedbackImages.MaxCount"/> pictures and the choice
/// to send with the Ember account or anonymously, stored as feedback from <c>discord</c>, linked to the user's Ember account when
/// they have one and didn't choose anonymous (never creating one). Limited by <see cref="FeedbackCooldown"/>, checked on open and
/// counted on submit. Pictures are downloaded only from <see cref="AttachmentHosts"/> over https, at most
/// <see cref="FeedbackImages.MaxTotalBytes"/> by their declared sizes before downloading, then go through
/// <see cref="FeedbackImages.Sanitize"/>; one picture that fails rejects the whole report.
/// </summary>
public class FeedbackModule : InteractionModuleBase<SocketInteractionContext>
{
    internal const string ModalId = "feedback:modal";

    /// <summary>The named <see cref="HttpClient"/> for picture downloads: 15 s timeout, no redirects; each whole download (headers and body) also gets 15 s.</summary>
    public const string HttpClientName = "feedback-images";

    internal const string AnonymousValue = "anonymous";

    private static readonly string[] AttachmentHosts = ["cdn.discordapp.com", "media.discordapp.net"];

    private static readonly TimeSpan DownloadTimeout = TimeSpan.FromSeconds(15);

    private readonly HabitService _habits;
    private readonly FeedbackCooldown _cooldown;
    private readonly IHttpClientFactory _httpClients;

    public FeedbackModule(HabitService habits, FeedbackCooldown cooldown, IHttpClientFactory httpClients)
    {
        _habits = habits;
        _cooldown = cooldown;
        _httpClients = httpClients;
    }

    [SlashCommand("feedback", "Tell the Ember team what would make Ember better")]
    public async Task FeedbackAsync()
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        if (!_cooldown.CanSend(Context.User.Id))
        {
            await RespondAsync(t.Get("feedback.cooldown"), ephemeral: true);
            return;
        }

        await RespondWithModalAsync(Modal(t));
    }

    /// <summary>The <see cref="FeedbackModal"/> form (same custom ids and limits) with its labels in the user's language.</summary>
    internal static Modal Modal(Texts t)
    {
        var identity = new SelectMenuBuilder()
            .WithCustomId("feedback_identity")
            .WithMinValues(1)
            .WithMaxValues(1)
            .AddOption(t.Get("feedback.modal.account"), "account", isDefault: true)
            .AddOption(t.Get("feedback.modal.anonymous"), AnonymousValue);

        return new ModalBuilder()
            .WithTitle(t.Get("feedback.modal.title"))
            .WithCustomId(ModalId)
            .AddTextInput(t.Get("feedback.modal.feedback-title"), "feedback_title", TextInputStyle.Short,
                minLength: 1, maxLength: HabitService.MaxFeedbackTitleLength, required: true)
            .AddTextInput(t.Get("feedback.modal.text"), "feedback_text", TextInputStyle.Paragraph,
                minLength: 1, maxLength: HabitService.MaxFeedbackLength, required: true)
            .AddFileUpload(t.Get("feedback.modal.pictures"), "feedback_pictures", 0, FeedbackImages.MaxCount, false,
                description: t.Get("feedback.modal.pictures-hint"))
            .AddSelectMenu(t.Get("feedback.modal.identity"), identity)
            .Build();
    }

    [ModalInteraction(ModalId)]
    public async Task OnModalAsync(FeedbackModal modal)
    {
        var t = await BotTexts.ForAsync(_habits, Context.Interaction);
        var title = modal.FeedbackTitle.Trim();
        var text = modal.Text.Trim();
        if (HabitService.FeedbackTitleError(title) is not null || HabitService.FeedbackTextError(text) is not null)
        {
            await RespondAsync(t.Get("feedback.invalid"), ephemeral: true);
            return;
        }

        var pictures = modal.Pictures ?? [];
        if (pictures.Length > FeedbackImages.MaxCount || pictures.Sum(p => (long)p.Size) > FeedbackImages.MaxTotalBytes)
        {
            await RespondAsync(t.Get("feedback.too-many-pictures"), ephemeral: true);
            return;
        }

        if (!_cooldown.TryRecord(Context.User.Id))
        {
            await RespondAsync(t.Get("feedback.cooldown"), ephemeral: true);
            return;
        }

        var images = new List<FeedbackImage>(pictures.Length);
        if (pictures.Length > 0)
        {
            await DeferAsync(ephemeral: true);
            long bytes = 0;
            foreach (var picture in pictures)
            {
                if (await DownloadAsync(_httpClients, picture.Url, picture.Size) is not { } data)
                {
                    await FollowupAsync(t.Get("feedback.fetch-failed"), ephemeral: true);
                    return;
                }

                if (FeedbackImages.Sanitize(data, out _) is not { } image)
                {
                    await FollowupAsync(t.Get("feedback.picture"), ephemeral: true);
                    return;
                }

                images.Add(image);
                bytes += data.Length;
            }

            if (!_cooldown.TryRecordBytes(Context.User.Id, bytes))
            {
                await FollowupAsync(t.Get("feedback.picture-budget"), ephemeral: true);
                return;
            }
        }

        Guid? userId = null;
        if (modal.Identity != AnonymousValue && await _habits.FindDiscordUserAsync(Context.User.Id) is var found && found != Guid.Empty) userId = found;
        var saved = await _habits.SaveFeedbackAsync(userId, "discord", null, text, default, title, images);
        var reply = t.Get(saved ? "feedback.thanks" : "feedback.daily-limit");
        if (Context.Interaction.HasResponded) await FollowupAsync(reply, ephemeral: true);
        else await RespondAsync(reply, ephemeral: true);
    }

    /// <summary>
    /// Downloads a Discord attachment of <paramref name="size"/> declared bytes, only over https from the Discord CDN hosts on the
    /// default port, within the download timeout and never reading more than declared. Null when any of that fails.
    /// </summary>
    internal static async Task<byte[]?> DownloadAsync(IHttpClientFactory clients, string url, int size)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort
            || !AttachmentHosts.Contains(uri.Host) || size <= 0)
            return null;

        try
        {
            using var timeout = new CancellationTokenSource(DownloadTimeout);
            using var response = await clients.CreateClient(HttpClientName).GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode) return null;

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            var buffer = new byte[size + 1];
            var read = 0;
            int chunk;
            while (read < buffer.Length && (chunk = await stream.ReadAsync(buffer.AsMemory(read), timeout.Token)) > 0) read += chunk;
            return read == 0 || read > size ? null : buffer[..read];
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
        {
            return null;
        }
    }
}

public class FeedbackModal : IModal
{
    public string Title => "Send feedback";

    [InputLabel("Title")]
    [ModalTextInput("feedback_title", TextInputStyle.Short, minLength: 1, maxLength: HabitService.MaxFeedbackTitleLength)]
    public string FeedbackTitle { get; set; } = "";

    [InputLabel("What would make Ember better?")]
    [ModalTextInput("feedback_text", TextInputStyle.Paragraph, minLength: 1, maxLength: HabitService.MaxFeedbackLength)]
    public string Text { get; set; } = "";

    [InputLabel("Pictures (optional)", "Up to 5 JPEG, PNG or WebP pictures, 10 MB together")]
    [RequiredInput(false)]
    [ModalFileUpload("feedback_pictures", minValues: 0, maxValues: FeedbackImages.MaxCount)]
    public IAttachment[]? Pictures { get; set; }

    [InputLabel("Send as")]
    [ModalSelectMenu("feedback_identity", minValues: 1, maxValues: 1)]
    [ModalSelectMenuOption("Send with my Ember account", "account", isDefault: true)]
    [ModalSelectMenuOption("Send anonymously", FeedbackModule.AnonymousValue)]
    public string Identity { get; set; } = "account";
}
