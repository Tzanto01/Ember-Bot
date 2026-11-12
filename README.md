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
| `/feedback` | Tell the Ember team what would make Ember better, in a short form (up to 5 per hour) |

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
| 🔔 **DM reminders** | Sent at your local time, also across daylight saving changes, with **Done**, **Skip for today** and **Snooze 1h** buttons: one tap to check in, skip or snooze. If Discord has a hiccup, Ember tries again up to twice, 5 minutes apart. Reminders missed by more than 2 hours (for example during downtime) are skipped, not sent late. If 3 DMs in a row can't be delivered, reminders pause and Ember tells you the next time you use it, with a **Try again** button |
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
- **Done outside Discord:** a web push reminder for a single habit has a **Done ✅** button that logs that day without opening Ember (the notification still names no habit), and the Android app's single-habit reminders offer **Done** even with habit names hidden.
- **Consent:** habit names, check-ins, low days, day notes and moods can say something about your health, so Ember asks for your OK before storing them, and again when the privacy policy changes. After "No thanks" it waits 30 days before asking on its own. You can withdraw any time with `/privacy delete`.
- **Unconfirmed accounts:** a web signup whose email is never confirmed is deleted after 7 days, unless it has a Discord or other linked login or holds any habits or other data.

---

## Self-Hosting

Ember runs as a hosted private preview for now; a public bot invite is planned for launch.

You can also run your own instance from this source code.

The bot runs as a Docker container (`docker/bot.Dockerfile`, `docker-compose.yml`). You need Docker with Compose, a Discord bot application, and a PostgreSQL server that the container reaches as host `postgres` on an existing external Docker network named `homeserver-net` (database `emberdb`). Put a `.env` file (gitignored) next to `docker-compose.yml`:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `DB_USER`, `DB_PASSWORD` | PostgreSQL login |
| `DEV_GUILD_ID` | Optional. Also registers the slash commands to this server, where changes show up instantly |
| `PRIVACY_POLICY_URL` | Optional. Privacy policy link shown in the consent prompt and `/help`; when it ends in `/legal/privacy`, `/help` also links that site's `/legal/imprint` |
| `WEB_ORIGIN` | Public origin of the web app; the bot links to it, and the API (required there) uses it for links in emails and CORS |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Web Push keys and contact; without them no push reminders are sent |
| `API_KNOWN_PROXY`, `API_KNOWN_NETWORK` | API only, at least one required. The reverse proxy whose forwarded headers the API trusts: a single address, or a network in CIDR form (see below) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | API only. Mail server login and sender address for account emails; the port defaults to 587 |
| `SMTP_REPLY_TO` | API only, optional. Address for the `Reply-To` header of account emails; without it replies go to `SMTP_FROM` |
| `FEEDBACK_DIGEST_TO` | API only, optional. Address that gets the daily feedback digest (08:00 Europe/Berlin, only when there is new feedback) over the SMTP settings above; without it feedback is stored but not mailed |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API only. Discord OAuth application for signing in with and linking Discord (web and the Android app, which returns through `app.ember.habits://auth/discord`; Discord only needs the web redirect URI) |

**Client IP behind a tunnel.** Rate limits key on the client IP, which the API only takes from `X-Forwarded-For` when the request comes from a trusted proxy; from anywhere else the header is ignored silently and every visitor shares one limit. When cloudflared runs as a container on `homeserver-net`, Docker assigns its address and may change it on restart, so trust the network instead of one address: find the subnet with `docker network inspect homeserver-net --format '{{(index .IPAM.Config 0).Subnet}}'` and set it as `API_KNOWN_NETWORK` (for example `172.18.0.0/16`). Every container on that network can then claim any client IP, so only do this when you trust them all; otherwise give cloudflared a fixed `ipv4_address` and set that as `API_KNOWN_PROXY`. Keep the API port bound to `127.0.0.1` so the tunnel stays the only way in from outside. To check, exceed a login limit from one connection and confirm a second connection still gets through.

The API container reports its health to Docker (`docker compose ps`) by calling its own `/health`, which also checks the database. Both containers are capped at 512 MB of memory.

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
