using Discord;
using Ember.Bot;
using FluentAssertions;

namespace Ember.Tests;

public class BotServiceTests
{
    [Fact]
    public async Task StartClientAsync_SetsOnlineStatusBeforeLoginAndStart()
    {
        var calls = new List<string>();

        Task SetStatusAsync(UserStatus status)
        {
            calls.Add($"status:{status}");
            return Task.CompletedTask;
        }

        Task LoginAsync()
        {
            calls.Add("login");
            return Task.CompletedTask;
        }

        Task StartAsync()
        {
            calls.Add("start");
            return Task.CompletedTask;
        }

        await BotService.StartClientAsync(SetStatusAsync, LoginAsync, StartAsync);

        calls.Should().Equal("status:Online", "login", "start");
    }
}
