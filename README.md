# 🔥 Ember

A low-pressure, neurodivergent-friendly Discord habit tracker bot.

**Core philosophy:** No punishment, no guilt. Progress over perfection.

---

## Commands

### Habits

| Command | Description |
|---|---|
| `/habit add <name>` | Start tracking a new habit. Offers to set a daily reminder. |
| `/habit list` | See all your habits, 7-day progress, and reminder times. |
| `/habit checkin [habit] [completed]` | Log today's check-in (autocomplete, defaults to ✅ done). |
| `/habit streak` | See full stats: 7-day, 30-day, best streak, total check-ins. |
| `/habit edit [habit] [name] [clear_reminder]` | Rename a habit or change/remove its reminder. |
| `/habit delete [habit]` | Stop tracking a habit. |

### Timezone

| Command | Description |
|---|---|
| `/timezone set <timezone>` | Set your local timezone (autocomplete — just start typing your city). |
| `/timezone show` | Show your current timezone. |

> Set your timezone before adding reminders so they fire at the right local time.

---

## Features

- **Flexible streaks** — "X out of last 7 days", not just consecutive days
- **Daily DM reminders** with ✅ / ❌ buttons — one tap to check in
- **Adaptive reminder tone** — softer language when you've had a quiet week
- **Weekly summary DM** — every Sunday at 09:00 UTC with a 7-day recap
- **Autocomplete** on all habit and timezone inputs
- **Privacy by default** — all data is private to you

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

Tests cover streak logic, timezone helpers, and cron expression generation.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | C# / .NET 10 |
| Discord library | Discord.Net 3.19.1 |
| Scheduler | Quartz.NET |
| Database | PostgreSQL via Npgsql EF Core |
| Hosting | systemd on Linux |
