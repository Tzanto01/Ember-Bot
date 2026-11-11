<div align="center">

# Ember

**A gentle habit tracker for Discord, made with ADHD and neurodivergent brains in mind.**

[![License](https://img.shields.io/badge/license-Non--Commercial-orange)](LICENSE)
[![.NET](https://img.shields.io/badge/.NET-10-512BD4)](https://dotnet.microsoft.com)
[![Discord.Net](https://img.shields.io/badge/Discord.Net-3.19.1-5865F2)](https://github.com/discord-net/Discord.Net)

</div>

---

## What is Ember?

Ember is a Discord bot for keeping up habits when consistency is hard, for example with ADHD, autism or executive dysfunction. Missing a day doesn't wipe out your progress, and Ember never scolds you for it.

You use it through menus and buttons. Commands take no parameters, so there is no syntax to remember.

---

## Commands

### Habits

| Command | What it does |
|---|---|
| `/habit add` | Create a new habit in a form |
| `/habit template` | Start from a ready-made habit |
| `/habit checkin` | Log today's check-in |
| `/habit history` | See the last 14 days of a habit, fill in or fix any day, and mark low days |
| `/habit list` | See all habits with their progress and reminders |
| `/habit streak` | See the full stats: streak, 7 days, 30 days, best and total |
| `/habit share` | Post a public streak card in the current channel |
| `/habit edit` | Rename a habit or change its reminder |
| `/habit delete` | Stop tracking a habit |
| `/habit pause` | Pause a habit. Reminders stop and the streak is kept |
| `/habit frequency` | Switch between daily and weekly (1 to 6 times a week) |
| `/habit grace` | Set how many flex days a week you get before a streak breaks (0 to 3) |
| `/habit second-reminder` | Get one more nudge after a reminder if you haven't checked in yet |

### Timezone

| Command | What it does |
|---|---|
| `/timezone set` | Set your local timezone (start typing your city) |
| `/timezone show` | See your current timezone |

> Set your timezone before adding reminders so they arrive at the right local time.

### Privacy and your data

| Command | What it does |
|---|---|
| `/export [format: csv\|json]` | Get your settings, habits, check-ins, low days and routines as CSV (default) or JSON in your DMs. Day notes, moods and account details are never sent through Discord; the full export is in the web app's Settings |
| `/privacy delete` | Permanently delete everything Ember stores about you, after you confirm with a button |

### Other

| Command | What it does |
|---|---|
| `/help` | See all commands in one place |
| `/link` | Open the web app (Sign in with Discord uses the same account), or link Discord to an email account and optionally move your habits there |

---

## Features

- **Menus and buttons only.** Nothing to type or remember.
- **Flexible streaks.** Progress counts as "X of the last 7 days", so one missed day doesn't reset everything.
- **Grace days.** Choose how many flex days a week you get before a streak resets.
- **Habit templates** to get started quickly.
- **Pause** a habit and keep its streak.
- **Daily or weekly habits.** Track every day, or set a weekly target of 1 to 6 times.
- **DM reminders** at your local time, including across daylight saving changes. Each one has **Done**, **Skip for today** and **Snooze 1h** buttons. If Discord fails to deliver one, Ember tries twice more, 5 minutes apart. Reminders that would be more than 2 hours late (for example after downtime) are skipped. If 3 DMs in a row can't be delivered, reminders pause and Ember tells you the next time you use it, with a **Try again** button.
- **Adaptive tone.** The wording gets softer after a quiet week.
- **Gentle check-in.** If yesterday is still unlogged, Ember sends a DM asking whether you want to log it or mark it as a low day.
- **Weekly summary** of the past 7 days in your DMs, every Sunday morning in your timezone.
- **Private by default.** Only you see Ember's replies. `/habit share` is the one command that posts in a channel.

---

## Backfill, open days and low days

- **Backfill:** `/habit history` shows the last 14 days of a habit as buttons. Tap a day to cycle it through ✅ done, ➖ not done and ▫️ not logged. You can fill in any day since the habit started, so fixing last week takes a few taps, and streaks update right away.
- **Open days:** today and yesterday are always open. An open day that isn't logged yet never counts against a streak; it only becomes a gap once it closes. Older days can still be filled in later.
- **Low days:** pick a day in the 🌙 menu under the history grid, or tap **It was a low day** in the check-in DM. A low day covers all your habits: it doesn't break or extend a streak, and it counts as kept in the 7 day and 30 day views. Pick it again to remove it.
- **Reminder buttons** work until 10:00 the next morning, or until that day is logged anywhere (bot or web), whichever comes first. After that the buttons disappear and the message says `✅ Logged.` or `This reminder has closed.` You can still fill in the day with `/habit history` or on the web.
- **Second reminder:** `/habit second-reminder` (Off, 15 minutes, 30 minutes, 1 hour or 2 hours) sends one more nudge that long after a reminder if the day is still open. It replaces the first message. Snoozing replaces it too, Skip cancels it, and there is never a third.
- **Done outside Discord:** a web push reminder for a single habit has a **Done ✅** button that logs the day without opening Ember (the notification itself doesn't name the habit). The Android app's single habit reminders offer **Done** even when habit names are hidden.
- **Consent:** habit names, check-ins, low days, day notes and moods can reveal things about your health, so Ember asks for your permission before storing them, and asks again when the privacy policy changes. If you say "No thanks", it waits 30 days before asking again on its own. You can withdraw at any time with `/privacy delete`.
- **Unconfirmed accounts:** a web signup whose email is never confirmed is deleted after 7 days, unless it has a Discord or other linked login, or holds habits or other data.

---

## Self-hosting

Ember is in public beta at [beta.ember-glow.app](https://beta.ember-glow.app). The [download page](https://beta.ember-glow.app/download) has the Android app and the invite link for the Discord bot.

You can also run your own instance from this source code.

The bot runs as a Docker container (`docker/bot.Dockerfile`, `docker-compose.yml`). You need Docker with Compose, a Discord bot application, and a PostgreSQL server that the container can reach as host `postgres` on an existing external Docker network called `homeserver-net` (database `emberdb`). Put a `.env` file (gitignored) next to `docker-compose.yml`:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `DB_USER`, `DB_PASSWORD` | PostgreSQL login |
| `DEV_GUILD_ID` | Optional. Also registers the slash commands on this server, where changes show up immediately |
| `PRIVACY_POLICY_URL` | Optional. Privacy policy link shown in the consent prompt and in `/help`. If it ends in `/legal/privacy`, `/help` also links that site's `/legal/imprint` |
| `WEB_ORIGIN` | Public origin of the web app. The bot links to it, and the API (where it is required) uses it for links in emails and for CORS |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional. Web Push keys and contact. Without them, no push reminders are sent |
| `API_KNOWN_PROXY`, `API_KNOWN_NETWORK` | API only, at least one is required. The reverse proxy whose forwarded headers the API trusts, as a single address or a CIDR network (see below) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | API only. Mail server login and sender address for account emails. The port defaults to 587 |
| `SMTP_REPLY_TO` | API only, optional. `Reply-To` address for account emails. Without it, replies go to `SMTP_FROM` |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API only. Discord OAuth application for signing in with Discord and linking it, on the web and in the Android app. The app returns through `app.ember.habits://auth/discord`, but Discord only needs the web redirect URI |

**Client IP behind a tunnel.** Rate limits are keyed on the client IP. The API only reads it from `X-Forwarded-For` when the request comes from a trusted proxy. From anywhere else it silently ignores the header, and then every visitor shares one limit. If cloudflared runs as a container on `homeserver-net`, Docker assigns its address and may change it on restart, so trust the network rather than a single address: get the subnet with `docker network inspect homeserver-net --format '{{(index .IPAM.Config 0).Subnet}}'` and set it as `API_KNOWN_NETWORK` (for example `172.18.0.0/16`). Every container on that network can then claim any client IP, so only do this if you trust all of them. Otherwise give cloudflared a fixed `ipv4_address` and set that as `API_KNOWN_PROXY`. Keep the API port bound to `127.0.0.1` so the tunnel is the only way in from outside. To check the setup, go over a login limit from one connection and make sure a second connection still gets through.

The API container reports its health to Docker (`docker compose ps`) by calling its own `/health` endpoint, which also checks the database. Both containers are limited to 512 MB of memory.

Then run `docker compose up -d --build`. On startup the bot applies pending database migrations and registers its slash commands. Back up the database before deploying a build with a new migration.

**Deploying (maintainer).** Copy `deploy.ps1.example` to `deploy.ps1` (gitignored), fill in your server details and the path to the shared [homeserver-deploy](https://github.com/Tzanto01/homeserver-deploy) tool, then run `.\deploy.ps1` (`-DryRun` and `-SkipTests` are available). It runs the tests and only ships committed code. The homeserver-deploy README explains what happens on the server.

---

## Development

```bash
# Build
dotnet build

# Run tests
dotnet test
```

The tests cover streak logic, weekly progress, local days and timezones, reminder dispatch, export, data deletion, habit templates and the interaction routing contracts. The PostgreSQL migration tests need Docker and are skipped locally without it (set `CI=true` to force them).

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | C# / .NET 10 |
| Discord library | Discord.Net 3.19.1 |
| Scheduler | Quartz.NET |
| Database | PostgreSQL via Npgsql EF Core |
| Hosting | Docker Compose on Linux |

---

## Legal

The privacy policy (Datenschutzerklärung), terms of use and imprint are in [`docs/legal/`](docs/legal/). They are drafts awaiting legal review and haven't been published yet.

---

## License

Custom non-commercial license, see [LICENSE](LICENSE).  
© 2026 Tzanto01. Non-commercial use only, credit required.
