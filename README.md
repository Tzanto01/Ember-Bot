<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/banner-dark.svg">
  <img src="docs/readme/banner-light.svg" width="846" alt="Ember. A calm place for your habits. The Ember flame beside a small campfire on an evening hillside.">
</picture>

<p>
  <a href="https://beta.ember-glow.app"><img src="docs/readme/get-web.svg" height="46" alt="Open the web app"></a>
  <a href="https://beta.ember-glow.app/download"><img src="docs/readme/get-android.svg" height="46" alt="Get the Android app"></a>
  <a href="https://beta.ember-glow.app/download"><img src="docs/readme/get-discord.svg" height="46" alt="Add to Discord"></a>
</p>

[![License: Non-Commercial](https://img.shields.io/badge/license-Non--Commercial-f69835?style=flat-square&labelColor=2a211c)](LICENSE) [![Status: public beta](https://img.shields.io/badge/status-public%20beta-b35c00?style=flat-square&labelColor=2a211c)](https://beta.ember-glow.app) [![.NET 10](https://img.shields.io/badge/.NET-10-f69835?style=flat-square&labelColor=2a211c)](https://dotnet.microsoft.com) [![Discord.Net 3.19.1](https://img.shields.io/badge/Discord.Net-3.19.1-b35c00?style=flat-square&labelColor=2a211c)](https://github.com/discord-net/Discord.Net) ![React 19](https://img.shields.io/badge/React-19-c98a3c?style=flat-square&labelColor=2a211c) ![Capacitor 8](https://img.shields.io/badge/Capacitor-8-c98a3c?style=flat-square&labelColor=2a211c)

</div>

## What is Ember?

**A small campfire for big moments.**

A calm companion for hard moments and gentle days. When a moment gets too big, tap **I need a moment**. On the other days, Ember is a habit tracker for people who find consistency hard. Missing a day doesn't wipe out your progress, and Ember never scolds you for it.

Ember is a web app and an Android app. If you use Discord, you can add the Ember bot too. Use the same account everywhere and your habits and check-ins stay in sync, so a check-in on your phone shows up in the web app (and in Discord, if you use it).

Ember is in public beta at [beta.ember-glow.app](https://beta.ember-glow.app).

## Worum geht es bei Ember?

Ember ist ein ruhiger Begleiter für schwere Momente und sanfte Tage. Du nutzt es als Web-App oder als Android-App, und wenn du magst, auch als Discord-Bot.

Wenn dir gerade alles zu viel wird, tippst du auf „Ich brauche einen Moment“. Ember fragt, was los ist, und geht mit dir eine kurze Übung durch, zum Beispiel ruhiges Atmen oder 5-4-3-2-1. Das klappt auch ohne Konto und offline. Gespeichert wird davon nichts, außer du willst eine Notiz in deinem privaten Tagebuch behalten.

An den anderen Tagen gibt es sanfte Habits: kleine Gewohnheiten wie ein Glas Wasser trinken oder zehn Seiten lesen, an die Ember dich freundlich erinnert. Ein schlechter Tag zählt nicht gegen dich. Du kannst ihn als Tief markieren oder später nachtragen, und Streaks sind freiwillig. Dazu kommt ein Tagebuch mit Stimmungen, auf Wunsch Ende-zu-Ende-verschlüsselt.

Ember ist kostenlos, noch in der Beta und kein medizinischer Dienst. Im Notfall ruf die 112 an.

## Get Ember

| Way in | What it is | Get it |
|---|---|---|
| **Web app** | Runs in your browser. Sign in with email or Discord, or use it without an account on one device. | [beta.ember-glow.app](https://beta.ember-glow.app) |
| **Android app** | The web app as an Android app, with a home screen widget and phone reminders. It is an APK file from the download page, not a Google Play app. | [Download page](https://beta.ember-glow.app/download) |
| **Discord bot** (optional) | If you use Discord: slash commands and reminder DMs there. | [Download page](https://beta.ember-glow.app/download), which has the invite link |

On the web and in the Android app you create an account with an email address and a password, or sign in with Discord if you use it. An email address has to be confirmed before you can sign in. `/link` in Discord shows you how to open the web app. If you already have an email account, you can link Discord to it in Settings, and Ember offers to move your Discord habits over.

You can also use the web app and the Android app without an account. Your data then stays on that device.

## A look inside

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/history-dark.png">
    <img src="docs/readme/history-light.png" width="820" alt="The History screen for one habit: a month calendar with done days, a paused stretch, a low day, open days and today, with streak and recent-period tiles beside it.">
  </picture>
</p>

**History** shows one habit by month. Tap a day to fill it in or change it. Beside the calendar you see the current streak, the last 7 and 30 days and the month's totals.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/year-dark.png">
    <img src="docs/readme/year-light.png" width="820" alt="The Year screen: a heatmap of the last 12 months, each day shaded by how many habits were checked in, with a line saying how many of the last 30 days had a check-in.">
  </picture>
</p>

**History** also has a year view: the last 12 months as one heatmap, for all habits or for one habit.

## What makes it gentle

Hard moments come first. Tap **I need a moment** on Today or on the sign-in page. Ember walks you through it in four steps:

1. **Catch it.** A dim campfire screen and room to pause. Or go straight to a breathing practice.
2. **Name it.** Pick what it feels like, such as too much or racing, and how strong it is. You can skip this.
3. **Ride it out.** Follow a short practice one step at a time. You can skip any step, or skip to the end.
4. **Reflect, if you want.** Write what set it off and what helped. Saving is optional.

- 🕯️ **Works without an account.** The moment works offline and without an account. Your choices stay on your device. A reflection is saved only to your private, end-to-end encrypted journal, and only when that journal is turned on and unlocked.
- 🆘 **Crisis lines.** Every step has an Urgent help button with crisis lines for your region. Ember isn't a crisis service, and it doesn't read what you write.

And on the other days: gentle habits.

- 🔥 **Optional streaks.** New accounts start with streaks off. Turn them on in Settings under Habits & days, with Show streaks. Existing accounts keep theirs on. With streaks on, pick how many unlogged days a week a streak can carry before it resets, from 0 to 3. Set it with `/habit grace` in Discord or in Settings on the web.
- 🌙 **Low days.** Mark a day as a low day. It covers all your habits: the streak neither breaks nor grows, and the day counts as kept in the 7 and 30 day views.
- ✏️ **Open days and backfill.** Today and yesterday stay open. Older days can be filled in later: the last 14 days in Discord, and back to the habit's start on the web.
- 📅 **Flexible schedules.** Daily, a weekly target of 1 to 6 times, specific weekdays, or up to 10 times a day for daily and weekday habits.
- ⏰ **Reminders where you are.** Discord DMs have **Done**, **Skip for today** and **Snooze 1h** buttons. Web push and Android notifications have a **Done** button for single habits. Reminders follow your local time, including across daylight saving changes.
- 🧭 **Routines.** Group habits into a routine with one reminder that lists only the habits still open that day. You set routines up on the web or in the Android app.
- ⏸️ **Pause.** Pause a habit for a set time. Reminders stop, and the streak is kept.
- 📨 **Gentle check-ins and a weekly recap.** In Discord, if a daily habit is still open for yesterday, Ember sends a DM at 10:00 your time. Every Sunday at 9:00 your time, you get a recap of the last 7 complete days. After a quiet week, the reminders are worded more softly.
- 🔒 **Private by default.** Only you see Ember's replies in Discord. `/habit share` is the one command that posts in a channel. The optional private journal is end-to-end encrypted on your device.

## Themes

Ember has four themes, each with a light and a dark version. Pick one in Settings under Appearance. The theme follows your account, and light or dark is set per device.

- 🕯️ **Hearthlight.** A candle-lit kitchen table: warm, soft, familiar. This is the default.
- 📓 **Fieldnotes.** A pocket notebook: grounded, quiet, literary.
- 🌊 **Tidepool.** A morning by the water: cool, airy, unhurried.
- 🌼 **Marigold.** A sticker sheet: playful, confident, high contrast.

<p align="center">
  <img src="docs/readme/theme-hearthlight.png" width="23%" alt="The Today screen in the Hearthlight theme, with four habits and two of them checked in.">
  <img src="docs/readme/theme-fieldnotes.png" width="23%" alt="The same Today screen in the Fieldnotes theme.">
  <img src="docs/readme/theme-tidepool.png" width="23%" alt="The same Today screen in the Tidepool theme.">
  <img src="docs/readme/theme-marigold.png" width="23%" alt="The same Today screen in the Marigold theme.">
</p>

<p align="center"><sub>The Today screen in Hearthlight, Fieldnotes, Tidepool and Marigold, all in light mode.</sub></p>

## Under the hood

Curious how it works, or want to run it yourself? The technical side lives in [TECHNICAL.md](TECHNICAL.md):

- ⌨️ [**Discord commands.**](TECHNICAL.md#discord-commands) Every slash command and how days, reminders and consent work.
- 🏠 [**Self-hosting.**](TECHNICAL.md#self-hosting) Run your own instance with Docker.
- 🛠️ [**Development.**](TECHNICAL.md#development) Code layout, builds and tests.
- 🧱 [**Tech stack.**](TECHNICAL.md#tech-stack) What Ember is built with.
- ⚖️ [**Legal.**](TECHNICAL.md#legal) Where the privacy policy, terms and imprint live.

## License

Custom non-commercial license, see [LICENSE](LICENSE).  
© 2026 Tzanto01. Non-commercial use only, credit required.
