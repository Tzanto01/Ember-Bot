# 🔥 Ember

A low-pressure, neurodivergent-friendly Discord habit tracker bot.

**Core philosophy:** No punishment, no guilt. Progress over perfection.

---

## Commands

All commands use interactive menus and buttons — no parameters to remember.

### Habits

| Command | Description |
|---|---|
| `/habit add` | Start tracking a new habit via a modal. Offers to set a reminder after. |
| `/habit template` | Pick from a set of pre-built habit templates. |
| `/habit checkin` | Select a habit and log today's check-in. |
| `/habit list` | See all your habits, recent progress, and reminder times. |
| `/habit streak` | See full stats: streak, 7-day, 30-day, best, total check-ins. |
| `/habit edit` | Rename a habit or change/remove its reminder. |
| `/habit delete` | Stop tracking a habit. |
| `/habit pause` | Pause a habit temporarily — reminders stop and streak is protected. |
| `/habit frequency` | Switch a habit between daily and weekly (1×–6×/week). |
| `/habit grace` | Set how many flex days per week you get before a streak breaks (0–3). |
| `/habit share` | Post a public streak card in the current channel. |

### Timezone

| Command | Description |
|---|---|
| `/timezone set` | Set your local timezone (autocomplete — just start typing your city). |
| `/timezone show` | Show your current timezone. |

> Set your timezone before adding reminders so they fire at the right local time.

### Leaderboard & Privacy

| Command | Description |
|---|---|
| `/leaderboard` | See this week's top check-ins in the server. |
| `/privacy optout` | Remove yourself from all leaderboards. |
| `/privacy optin` | Re-join leaderboards. |

### Other

| Command | Description |
|---|---|
| `/help` | See all commands in one place. |
| `/export` | Export your habit data. |

---

## Features

- **Zero-parameter commands** — everything is driven by menus and buttons
- **Flexible streaks** — "X out of last 7 days", not just consecutive days
- **Grace days** — configurable missed-day forgiveness before a streak breaks
- **Habit templates** — pre-built habits to get started instantly
- **Pause** — take a break without losing your streak
- **Daily or weekly habits** — track every day, or set a weekly target
- **DM reminders** with ✅ / ❌ / ⏰ buttons — one tap to check in or snooze
- **Adaptive reminder tone** — softer language when you've had a quiet week
- **Missed day reflection** — gentle DM if you've missed a habit, not a guilt trip
- **Weekly summary DM** — every Sunday with a 7-day recap
- **Leaderboard** — optional server-wide check-in board with privacy opt-out
- **Streak sharing** — post a visual streak card publicly
- **Privacy by default** — all data is private to you; leaderboard is opt-out

---

## Self-Hosting

### Requirements

- .NET 10 SDK
- PostgreSQL database
- A Discord bot application ([Discord Developer Portal](https://discord.com/developers/applications))

### Configuration

Create `src/Ember.Bot/appsettings.json`:

```json
{
  "BotToken": "your-discord-bot-token",
  "DevGuildId": "",
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Database=ember;Username=postgres;Password=yourpassword"
  }
}
```

- `BotToken` — your bot's token from the Discord Developer Portal
- `DevGuildId` — set to your server's ID for instant command registration during development; leave empty for global registration
- `ConnectionStrings:DefaultConnection` — your PostgreSQL connection string

### Run locally

```bash
cd src/Ember.Bot
dotnet run
```

### Deploy to Linux (systemd)

Edit `deploy.ps1` and set your server details, then run:

```powershell
./deploy.ps1
```

This publishes for `linux-x64`, copies the output to your server via SCP, and restarts the `ember` systemd service.

---

## Development

```bash
# Build
dotnet build

# Run tests
dotnet test
```

Tests cover streak logic, weekly progress, timezone helpers, cron expression generation, habit templates, and interaction custom ID routing contracts.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | C# / .NET 10 |
| Discord library | Discord.Net 3.19.1 |
| Scheduler | Quartz.NET |
| Database | PostgreSQL via Npgsql EF Core |
| Hosting | systemd on Linux |

---

## License

Custom non-commercial license — see [LICENSE](LICENSE).
Copyright (c) 2026 Tzanto01. Non-commercial use only. Credit required.
