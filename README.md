<div align="center">

# 🔥 Ember

**A low-pressure, neurodivergent-friendly Discord habit tracker.**

*No punishment. No guilt. Just progress.*

[![License](https://img.shields.io/badge/license-Non--Commercial-orange)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4)](https://dotnet.microsoft.com)
[![Discord.Net](https://img.shields.io/badge/Discord.Net-3.19.1-5865F2)](https://github.com/discord-net/Discord.Net)

</div>

---

## What is Ember?

Ember is a Discord bot built for people who struggle with habit consistency — not because they don't care, but because of how their brain works. ADHD, autism, executive dysfunction — Ember meets you where you are.

Everything is driven by **menus and buttons**. No slash command parameters to memorise, no syntax to get wrong.

---

## Commands

### 🌿 Habits

| Command | What it does |
|---|---|
| `/habit add` | Create a new habit via a modal |
| `/habit template` | Start from a pre-built habit template |
| `/habit checkin` | Log today's check-in |
| `/habit list` | See all habits with progress and reminders |
| `/habit streak` | View full stats — streak, 7-day, 30-day, best, total |
| `/habit share` | Post a public streak card in this channel |
| `/habit edit` | Rename a habit or update its reminder |
| `/habit delete` | Stop tracking a habit |
| `/habit pause` | Pause a habit — reminders stop, streak is protected |
| `/habit frequency` | Switch between daily and weekly (1×–6×/week) |
| `/habit grace` | Set how many flex days per week before a streak breaks (0–3) |

### 🕐 Timezone

| Command | What it does |
|---|---|
| `/timezone set` | Set your local timezone (just start typing your city) |
| `/timezone show` | See your current timezone |

> Set your timezone before adding reminders so they fire at the right local time.

### 🏆 Leaderboard

The leaderboard is opt-in: nobody appears on it until they join. It shows display names (never mentions) and check-ins in that server over the last 7 days.

| Command | What it does |
|---|---|
| `/leaderboard` | Top check-ins of opted-in members in the server over the last 7 days |

### 🔒 Privacy and your data

| Command | What it does |
|---|---|
| `/privacy optin` | Join leaderboards (you're off them by default) |
| `/privacy optout` | Leave all leaderboards |
| `/export [format: csv\|json]` | Get all your data (settings, every habit, every check-in) as CSV (default) or JSON, sent to your DMs |
| `/privacy delete` | Permanently delete everything Ember stores about you, after a confirmation button |

### 📋 Other

| Command | What it does |
|---|---|
| `/help` | See all commands in one place |

---

## Features

| | |
|---|---|
| 🎛️ **Zero-parameter commands** | Everything is menus and buttons — nothing to memorise |
| 📈 **Flexible streaks** | "X out of last 7 days", not just consecutive days |
| 🌿 **Grace days** | Configurable missed-day forgiveness before a streak breaks |
| 📋 **Habit templates** | Pre-built habits to get started in seconds |
| ⏸️ **Pause** | Take a break without losing your streak |
| 📅 **Daily or weekly habits** | Track every day, or set a weekly target (1×–6×) |
| 🔔 **DM reminders** | Sent at your local time, also across daylight saving changes, with ✅ / ❌ / ⏰ buttons: one tap to check in or snooze. Reminders missed by more than 2 hours (for example during downtime) are skipped, not sent late. If 3 DMs in a row can't be delivered, reminders pause and Ember tells you the next time you use it, with a **Try again** button |
| 💙 **Adaptive tone** | Softer language when you've had a quiet week |
| 🤔 **Missed day reflection** | A gentle nudge, not a guilt trip |
| 📊 **Weekly summary** | Every Sunday morning, your local time — a 7-day recap in your DMs |
| 🏆 **Leaderboard** | Opt-in server check-in board; you only appear if you join |
| 🔒 **Private by default** | Replies are visible only to you. Only `/habit share` and `/leaderboard` post in a channel, and the leaderboard lists only members who opted in |

---

## Self-Hosting

Ember is hosted publicly — you don't need to run your own instance.

If the bot ever goes offline permanently, the source code is here so you can self-host as a fallback.

The bot runs as a Docker container (`docker/bot.Dockerfile`, `docker-compose.yml`). You need Docker with Compose, a Discord bot application, and a PostgreSQL server that the container reaches as host `postgres` on an existing external Docker network named `homeserver-net` (database `emberdb`). Put a `.env` file (gitignored) next to `docker-compose.yml`:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `DB_USER`, `DB_PASSWORD` | PostgreSQL login |
| `DEV_GUILD_ID` | Optional. Also registers the slash commands to this server, where changes show up instantly |

Then run `docker compose up -d --build`. On startup the bot applies any pending database migrations and registers its slash commands. Back up the database before you deploy a build that contains a new migration.

**Deploying (maintainer).** Copy `deploy.ps1.example` to `deploy.ps1` (gitignored), fill in your server details and the path to the shared [homeserver-deploy](https://github.com/Tzanto01/homeserver-deploy) tool, then run `.\deploy.ps1` (`-DryRun` and `-SkipTests` are available). It runs the tests and ships only committed code; see the homeserver-deploy README for what happens on the server.

---

## Development

```bash
# Build
dotnet build

# Run tests
dotnet test
```

Tests cover streak logic, weekly progress, local-day and timezone handling, reminder dispatch, export, data deletion, habit templates, and interaction routing contracts. The PostgreSQL migration tests need Docker; without it they are skipped locally (set `CI=true` to force them).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Language | C# / .NET 10 |
| Discord library | Discord.Net 3.19.1 |
| Scheduler | Quartz.NET |
| Database | PostgreSQL via Npgsql EF Core |
| Hosting | Docker Compose on Linux |

---

## Legal

The privacy policy (Datenschutzerklärung), terms of use and imprint are in [`docs/legal/`](docs/legal/). They are drafts pending legal review and not published yet.

---

## License

Custom non-commercial license — see [LICENSE](LICENSE).  
© 2026 Tzanto01 · Non-commercial use only · Credit required.
