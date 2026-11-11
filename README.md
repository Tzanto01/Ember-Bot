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
| `/habit history` | See the last 14 days of a habit, fill in or fix any day, and mark low days |
| `/habit list` | See all habits with progress and reminders |
| `/habit streak` | View full stats — streak, 7-day, 30-day, best, total |
| `/habit share` | Post a public streak card in this channel |
| `/habit edit` | Rename a habit or update its reminder |
| `/habit delete` | Stop tracking a habit |
| `/habit pause` | Pause a habit — reminders stop, streak is protected |
| `/habit frequency` | Switch between daily and weekly (1×–6×/week) |
| `/habit grace` | Set how many flex days per week before a streak breaks (0–3) |
| `/habit second-reminder` | Get one more nudge after a reminder if you haven't checked in yet |

### 🕐 Timezone

| Command | What it does |
|---|---|
| `/timezone set` | Set your local timezone (just start typing your city) |
| `/timezone show` | See your current timezone |

> Set your timezone before adding reminders so they fire at the right local time.

### 🔒 Privacy and your data

| Command | What it does |
|---|---|
| `/export [format: csv\|json]` | Get your settings, habits, check-ins, low days and routines as CSV (default) or JSON, sent to your DMs. Day notes, moods and account details never go to Discord; the full export is in the web app's Settings |
| `/privacy delete` | Permanently delete everything Ember stores about you, after a confirmation button |

### 📋 Other

| Command | What it does |
|---|---|
| `/help` | See all commands in one place |
| `/link` | Open the web app (Sign in with Discord lands in the same account), or link Discord to an email account, which offers to move your habits there |

---

## Features

| | |
|---|---|
| 🎛️ **Zero-parameter commands** | Everything is menus and buttons — nothing to memorise |
| 📈 **Flexible streaks** | "X out of last 7 days", not just consecutive days |
| 🌿 **Grace days** | Configurable flex days per week before a streak resets |
| 📋 **Habit templates** | Pre-built habits to get started in seconds |
| ⏸️ **Pause** | Take a break without losing your streak |
| 📅 **Daily or weekly habits** | Track every day, or set a weekly target (1×–6×) |
| 🔔 **DM reminders** | Sent at your local time, also across daylight saving changes, with ✅ / ❌ / ⏰ buttons: one tap to check in or snooze. Reminders missed by more than 2 hours (for example during downtime) are skipped, not sent late. If 3 DMs in a row can't be delivered, reminders pause and Ember tells you the next time you use it, with a **Try again** button |
| 💙 **Adaptive tone** | Softer language when you've had a quiet week |
| 🤔 **Gentle check-in** | If yesterday is still unlogged, a DM invites you to log it or call it a low day. A nudge, not a guilt trip |
| 📊 **Weekly summary** | Every Sunday morning, your local time — a 7-day recap in your DMs |
| 🔒 **Private by default** | Replies are visible only to you. Only `/habit share` posts in a channel |

---

## Backfill, open days and low days

- **Backfill:** `/habit history` shows the last 14 days of a habit as buttons. Tap a day to cycle it: ✅ done, ➖ not done, ▫️ not logged. Any day since the habit started can be filled in, so fixing last week takes a few taps, and streaks recalculate right away.
- **Open days:** today and yesterday are always open. An unlogged open day never counts against a streak; a day only counts as a gap once it has closed. Older days can still be filled in later.
- **Low days:** pick a day in the 🌙 menu under the history grid (or tap **It was a low day** in the check-in DM). A low day protects all your habits: it neither breaks nor extends a streak, and counts as kept in the 7-day and 30-day views. Pick it again to remove it.
- **Reminder buttons** work until 10:00 the next morning, or until that day is logged anywhere (bot or web), whichever comes first. Then the buttons go away and the message says `✅ Logged.` or `This reminder has closed.`; an old day can still be filled in with `/habit history` or on the web.
- **Second reminder:** `/habit second-reminder` (Off, 15 minutes, 30 minutes, 1 hour, 2 hours) sends one more nudge that long after a reminder if the day is still open. It replaces the first message, a snooze replaces it, Skip cancels it, and there is never a third.
- **Consent:** habit names, check-ins, low days, day notes and moods can say something about your health, so Ember asks for your OK before storing them, and again when the privacy policy changes. After "No thanks" it waits 30 days before asking on its own. You can withdraw any time with `/privacy delete`.
- **Unconfirmed accounts:** a web signup whose email is never confirmed is deleted after 7 days, unless it has a Discord or other linked login or holds any habits or other data.

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
| `PRIVACY_POLICY_URL` | Optional. Privacy policy link shown in the consent prompt and `/help`; when it ends in `/legal/privacy`, `/help` also links that site's `/legal/imprint` |
| `WEB_ORIGIN` | Public origin of the web app; the bot links to it, and the API (required there) uses it for links in emails and CORS |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Web Push keys and contact; without them no push reminders are sent |
| `API_KNOWN_PROXY` | API only. Address of the reverse proxy whose forwarded headers the API trusts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | API only. Mail server login and sender address for account emails; the port defaults to 587 |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API only. Discord OAuth application for signing in with and linking Discord |

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
