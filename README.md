# 🔥 Ember

> A low-pressure, neurodivergent-friendly Discord habit tracker.
> No punishment. No guilt. Just progress.

[![License](https://img.shields.io/badge/license-Non--Commercial-orange)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4)](https://dotnet.microsoft.com)
[![Discord.Net](https://img.shields.io/badge/Discord.Net-3.19.1-5865F2)](https://github.com/discord-net/Discord.Net)

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

| Command | What it does |
|---|---|
| `/leaderboard` | This week's top check-ins in the server |
| `/privacy optout` | Remove yourself from all leaderboards |
| `/privacy optin` | Rejoin leaderboards |

### 📋 Other

| Command | What it does |
|---|---|
| `/help` | See all commands in one place |
| `/export` | Export your habit data |

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
| 🔔 **DM reminders** | ✅ / ❌ / ⏰ buttons — one tap to check in or snooze |
| 💙 **Adaptive tone** | Softer language when you've had a quiet week |
| 🤔 **Missed day reflection** | A gentle nudge, not a guilt trip |
| 📊 **Weekly summary** | Every Sunday — a 7-day recap in your DMs |
| 🏆 **Leaderboard** | Server-wide check-in board with full privacy opt-out |
| 🔒 **Privacy by default** | All data is private; leaderboard is opt-out |

---

## Self-Hosting

Ember is hosted publicly — you don't need to run your own instance.

If the bot ever goes offline permanently, the source code is here so you can self-host as a fallback. You'll need .NET 10, PostgreSQL, and a Discord bot application. See `deploy.ps1` and `src/Ember.Bot/appsettings.json` as a starting point.

---

## Development

```bash
# Build
dotnet build

# Run tests
dotnet test
```

Tests cover streak logic, weekly progress, timezone helpers, cron expressions, habit templates, and interaction routing contracts.

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
© 2026 Tzanto01 · Non-commercial use only · Credit required.
