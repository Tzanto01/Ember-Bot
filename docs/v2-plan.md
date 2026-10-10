# Ember v2 plan

Ember goes from a personal Discord bot to a public, shame-free habit tracker with one account across Discord, web, mobile and (maybe) desktop.

This file is the working plan for the agent that implements it. The phases run in order. Inside a phase, slices can run in parallel only where the plan says so.

## Product principles (contracts — every phase preserves them)

1. **No punishment, no guilt.** Gentle wording, no red walls, no "you failed".
2. **History can always be completed later.** Any past day can be backfilled or corrected. A day only counts as missed once it is closed (see Phase 3). Ember never forces daily action.
3. **Low effort.** Menus and buttons in Discord; at most two taps for a check-in on every platform.
4. **Private by default.** Nothing is public unless the user explicitly opts in.
5. **Every day is the user's local day.** All "today", streak, weekly and reminder logic uses the user's own IANA timezone, never UTC.

## Current state (verified 2026-10-10)

- .NET 10, Discord.Net 3.19.1, EF Core 10 + Npgsql, Quartz 3.18.1. There is one project, `src/Ember.Bot`, holding the models, DbContext, services, jobs and Discord modules, plus `tests/Ember.Tests` (96 tests, all green).
- Production runs `faf442b` from branch `agent/discord-initial-presence`; `main` is one commit behind it. It is deployed with the `homeserver-deploy` shim (`deploy.ps1`, gitignored) to `/home/nico/ember/`.
- Unmerged: `trial/T4-claude` @ `f853056` has the reviewed weekly-summary rework (`WeeklySummaryService`, current streaks, 25-field-safe summary embed, 281 lines of tests). It merges cleanly onto `faf442b`. `trial/T4-codex` @ `c063438` is the losing alternative of the same work; don't merge it.
- User-owned uncommitted files in the main checkout are `deploy.ps1.example` (modified), `AGENTS.md`, `CLAUDE.md` and `.swarm/`. Never revert or commit them without Nico's say-so.
- Readiness review verdict: **not ready for public launch**. The findings are folded into Phases 1–2 below with file references.

## Decisions already made by Nico

| # | Decision |
|---|---|
| N1 | Ember is the side product. It doubles as a portfolio piece. |
| N2 | The day boundary is per user, in the user's own timezone. |
| N3 | The leaderboard becomes opt-in. Keeping it at all is open (D1). |
| N4 | Fix the confirmed bugs before any new platform work. |
| N5 | Accounts: normal email + password login, with Discord as an optional linked login. A bot-only user never needs a password. |
| N6 | Backfill-first. A "low day" can be set after the fact and never requires input on the day itself. |
| N7 | At public launch, Ember moves off the homeserver to a hosted server (VPS): API, web app, bot and database. |
| N8 | No DiGA, no body doubling, no AI features in v2. |

## Open decisions (defaults apply until Nico says otherwise)

| # | Question | Default | Needed by |
|---|---|---|---|
| D1 | Keep the leaderboard at all? | Keep it opt-in through Phase 1, then **remove it before public launch** unless Nico wants it. It cuts against "no comparison, no guilt". | Start of Phase 1 |
| D2 | License | Keep the current non-commercial license until a paid tier exists. Before taking any outside contribution or charging money, switch to proprietary or source-available. | Phase 10 |
| D3 | Days that stay open for backfill before counting as missed | 2 local days (today + yesterday). Older days can still be backfilled; that heals the streak retroactively. | Phase 3 |
| D4 | Desktop companion | No native app. The installed PWA covers desktop. Revisit only on the criteria in Phase 9. | Phase 9 |
| D5 | Ember+ price and payment provider | Free at launch. Later around €2–3/month via Stripe Billing on the web only. | Phase 10 |
| D6 | Domain name and VPS provider | Nico picks and pays. Default suggestion: Hetzner (EU, AVV/DPA available). | Phase 8 |

Escalate to Nico only for these, or for a genuinely new product, security or money decision. Everything else follows this plan.

---

## Phase 0: Repository baseline

Goal: one clean `main` that equals production plus the reviewed weekly-summary work, with CI on every branch.

1. Merge `v2/plan` into `main`. It contains production `faf442b` from `agent/discord-initial-presence` plus this plan.
2. Merge `trial/T4-claude` (`f853056`) on top. Run the full suite; it must stay green.
3. Leave `trial/T4-codex`, `opencode/mighty-wolf` and `copilot/*` untouched. List them for Nico as candidates for deletion; deleting them needs his approval.
4. `.github/workflows/ci.yml`: run on push to every branch and on PRs. Add a vulnerable-package check (`dotnet list package --vulnerable`) and fix NU1903 (`SQLitePCLRaw.lib.e_sqlite3`, test project only).
5. Add `.github/dependabot.yml` for NuGet and GitHub Actions.
6. **Migration test harness.** Today the tests are SQLite-only with `EnsureCreated` (`Ember.Tests.csproj:13`, `AppHost.cs:96-97`), so no migration SQL is ever exercised. Add a small Postgres Testcontainers fixture for migration and data-step tests. Phase 1 already ships migrations, so it has to be in place first. Keep the fast SQLite tests for everything else.
7. **Ask Nico D1 (leaderboard) now.** Phase 1.4 depends on the answer.

Acceptance: `main` contains `faf442b` and `f853056`; CI is green on `main`; `dotnet test` passes with at least 96 + the weekly-summary tests; at least one migration test runs against Postgres in CI.

**Migration safety rule (all phases).** `AppHost.InitializeAsync` runs `MigrateAsync` on every startup (`AppHost.cs:96-99`), so **deploying a build that contains a new migration runs that migration in production**. Before any such deploy:
- take a verified `pg_dump` (restore-tested);
- get Nico's explicit go for that deploy.

Only the bot process migrates; `Ember.Api` (Phase 5) never calls `MigrateAsync`. Rollback means restoring the dump; a `Down` migration is not a rollback plan once new data exists.

## Phase 1: Fix confirmed bugs (Nico's priority)

Each item is a separate commit with a regression test that fails before the fix.

1. **Per-user local day boundary (N2).**
   - Today `HabitService.cs:73` (`CheckInAsync`) and the streak, flexible-streak and weekly-progress code (`:103`, `:114`, `:198`) use `DateTime.UtcNow`.
   - Introduce `TimeProvider` (built into .NET) and a single helper that returns the user's local `DateOnly` from `User.Timezone`. Use it everywhere "today" is computed: services, jobs, button modules.
   - Tests: a user in UTC+10 and one in UTC−8 checking in late in their local evening land on their local date; streaks stay intact across midnight UTC.
   - **Switchover.** Existing logs were dated in UTC and have no timestamps, so they can't be re-dated; leave past data as is. For a user far from UTC, the switch can create one artificial gap or double day around deploy day. Treat a gap on the switchover date (a single constant) as covered, so nobody loses a streak because of the fix. Test it.
2. **Missed-day reflection week start.**
   - `MissedDayReflectionJob.cs:47` has an operator-precedence bug that yields a future date on every day except Monday.
   - Compute the local Monday correctly, per user, in the user's timezone.
   - The job claims per-user local windows (`:12-23`) but fires globally at 10:00 UTC (`AppHost.cs:65`). Make it send at a local morning hour per user (an hourly trigger that selects users whose local hour matches).
3. **25-field embed cap.**
   - `HabitModule.cs:149` (list) and `:233` (streak) add one embed field per habit. (`WeeklySummaryJob` is handled by the Phase 0 merge; verify it.)
   - Paginate with buttons or summarize beyond 25. Add a per-user habit limit (default 50) with gentle copy.
   - The per-user catch in the jobs must log the exception type and user, not swallow it silently.
4. **Leaderboard opt-in (N3).** If Nico answered D1 with "remove", this item becomes deleting the leaderboard (command, module, service method, opt-out field via migration, README) and the rest of this item is skipped. Otherwise:
   - Rename `User.LeaderboardOptOut` to `LeaderboardOptIn`, default `false`. The migration sets **every existing user to not opted in**, because nobody consented.
   - Leaderboard text uses display names only for opted-in users; no unsolicited mention pings.
   - Fix the "Resets each Monday" footer (`LeaderboardModule.cs:53`; the window is a rolling 7 days) or make it a real Monday week.
   - Move the mention formatting out of `HabitService.cs:322` into the module.
5. **Double-tap safety.** `EnsureUserAsync` and `CheckInAsync` (`HabitService.cs:22-26`, `:74-93`) check, then insert. Make them idempotent: catch the unique violation and re-read, or use an upsert.

Acceptance: all five have regression tests, the suite is green, and Nico confirms on his own Discord account. Deploying to the homeserver needs his explicit go.

## Phase 2: Public-launch blockers for the bot

Do item 4 (reminders) first; items 1 and 3 build on its design.

1. **Delete my data (GDPR Art. 17).** `/privacy delete` with a confirmation button. It deletes the `User` row with cascade (the model already cascades, `EmberDbContext.cs:29,40`). With the item-4 design, cascading the rows also removes the reminders.
2. **Complete export (Art. 15/20).** `/export` covers settings (timezone, grace, opt-in, reminder times, pause, created dates), habits with zero logs, and every log including the guild ID. Escape CSV formula characters (`= + - @`). Offer JSON alongside CSV. Make the README match the actual command name.
3. **Undeliverable DMs.** Handle Discord error 50007 in `DiscordDmSender.cs:22-28`. After 3 consecutive failures, pause that user's DM reminders and tell them in the next interaction. `ReminderJob.cs:78-81` currently retries forever.
4. **Reminders without DST drift, and scalable.**
   - Replace the one-Quartz-trigger-per-habit model (`ReminderScheduler.cs`, `TimezoneHelper.cs:19-26`) with a stored `NextReminderUtc` per habit.
   - One Quartz job runs every minute, sends due reminders, then recomputes the next local fire time in the user's timezone. That fixes DST and removes thousands of in-memory triggers.
   - Snooze sets `NextReminderUtc` to now + snooze.
   - A local time that falls into a DST spring-forward gap moves forward to the first valid time. An ambiguous fall-back time uses the first occurrence. A computation error must never leave `NextReminderUtc` unadvanced; otherwise the job retries that habit every minute.
   - Existing habits with a reminder get `NextReminderUtc` filled at startup.
   - After downtime, reminders overdue by more than 2 hours are skipped (advanced to the next occurrence), not sent in a burst.
   - The due loop sends through a small `IReminderChannel` interface (Discord DM now, web push in Phase 6). **The bot process hosts all scheduled jobs**, now and later; the API stays a stateless request handler.
   - Tests: spring-forward gap, fall-back ambiguity, startup fill, stale skip, snooze.
5. **Robustness.**
   - `BotService.cs:133-138`: a failed interaction must reply with a gentle error, not throw again.
   - Register slash commands once per deploy, not on every Ready (`:75-94`).
   - Add a `USER` to `docker/bot.Dockerfile`, plus structured logging with no habit names in logs.
6. **Privacy policy, terms, imprint.** Draft the texts in `docs/legal/` (German operator: a Datenschutzerklärung and an Impressum are required). Treat habit names and logs as potentially health data under GDPR Art. 9. Nico reviews them before publishing. Link them from `/help` and the bot profile.
7. **README:** Docker rather than systemd, `deploy.ps1.example`, correct command names, no "privacy by default" contradiction.

Acceptance: every item has a test where behavior changed. The readiness review's must-fix list (items 1–9) is fully closed. Recommended: an independent review by @security-reviewer for the erasure and export work.

## Phase 3: Backfill and low days (core product differentiator)

This lands in the bot first and gets reused by every client afterwards.

1. **Backfill.**
   - `CheckInAsync` takes an explicit local date.
   - Allowed: any date from habit creation to the user's local today. Not allowed: future dates.
   - Editing a past day sets done, not done or cleared. `HabitLog.Completed` already models done/not done; "cleared" deletes the row.
2. **Open days (D3).** Today and yesterday are *open*: an unlogged open day is pending, never missed. Streaks are computed (not stored), so backfilling an older day heals the streak retroactively. Document that rule in the code's doc comments.
3. **Low days (N6).**
   - New table `DayMark (UserId, Date, Kind)`, with `Kind = LowDay` for now.
   - A low day counts as protected for all of the user's habits: it neither breaks nor extends a streak, and it counts as "kept" for the X-of-7 view.
   - It can be set for any past day, today included, and removed again.
4. **Grace logic as documented.** Grace days apply per rolling 7-day window. Today it is a single backward walk (`HabitService.cs:107-110`). `BestStreak` honors grace and low days.
   - **Pause fix.** `PausedUntil` currently hides every day before the pause too (`:166-167`). Add a nullable `Habit.PausedFrom`, set when the user pauses, so only the paused range is excluded. Existing paused rows get the migration date as `PausedFrom`.
5. **Discord UX.**
   - `/habit history` shows the last 14 days as a button grid per habit: tap to toggle, with a "mark low day" menu.
   - The missed-day reflection DM becomes an invitation, because yesterday is still open under D3. Today it says "missed" (`MissedDayReflectionJob.cs:109`); remove that wording everywhere. New copy, along the lines of "Yesterday is still open: want to log it?", with "Log yesterday" and "It was a low day" buttons.
   - Reminder buttons no longer expire after 24 h (`CheckInButtonModule.cs:15`): an old button logs the day it was sent for.
6. **Tests:** backfill across a timezone change, a low day inside a grace window, a pause boundary, best streak with grace, and an open day not counting as missed.

Acceptance: Nico can fix last week entirely from Discord, and the stats match by hand calculation.

## Phase 4: Shared core extraction

Goal: the domain logic can be referenced by the API without Discord.

1. Create `src/Ember.Core` (class library). It holds the models, `EmberDbContext`, migrations, `HabitService`, the streak, weekly and local-day logic, templates, export building and the reminder due-time calculation. It has no Discord.Net reference.
2. `src/Ember.Bot` references Core and keeps only the Discord adapters: modules, `BotService`, `DiscordDmSender`, and the Quartz jobs that send Discord DMs.
3. `TimezoneModule` (`:63-66`), `OnboardingModule` (`:225`) and the jobs that query `EmberDbContext` directly go through Core services. The jobs stay hosted in the bot process (see Phase 2.4).
4. Move the tests accordingly. Behavior does not change in this phase; the suite stays green.

Acceptance: `Ember.Core.csproj` has no Discord package reference, and all tests pass unchanged in meaning.

## Phase 5: Accounts and the API

1. **Identity model (N5).**
   - `User` becomes the ASP.NET Core Identity user: `User : IdentityUser<Guid>`, keeping Timezone, GraceDaysPerWeek and LeaderboardOptIn.
   - The Discord identity lives **only** in `AspNetUserLogins` (provider `Discord`, key = Discord user ID). A bot-only user is an Identity user with no email and no password.
   - Identity's required fields are always filled. Bot-only users, both migrated and new, get a synthetic `UserName`/`NormalizedUserName` (`discord_{id}`) plus a `SecurityStamp` and `ConcurrencyStamp`; otherwise `UserValidator` rejects creation and the claims factory throws on sign-in.
   - The bot resolves Discord ID to user ID through one Core method (`ResolveOrCreateDiscordUserAsync`). It does a **direct lookup** on the `AspNetUserLogins` primary key, with **no cache**: the API can merge or delete accounts, and a cache in the bot process would go stale.
   - Table naming: decide explicitly and write it in the migration. The default is to let Identity use its standard `AspNetUsers` table name and rename the existing `Users` table into it.
2. **Migration (the riskiest step).**
   - **Hand-write the SQL** (via `migrationBuilder.Sql`). Don't let EF scaffold an `AlterColumn` from `bigint` to `uuid`: Postgres can't cast it, and the user mapping would be lost.
   - Steps:
     1. Add a `uuid` id to the users table and fill a new GUID per row; fill the Identity columns as in 5.1.
     2. Insert one `AspNetUserLogins` row per existing Discord user.
     3. Add a `UserGuid` column to **every** table with a user FK: `Habits`, `DayMarks` (Phase 3) and any other table added in Phases 1–3. Fill it by joining on the Discord ID.
     4. Verify: row counts are unchanged, and no `UserGuid` is null or orphaned.
     5. Then swap the primary key and FKs, and drop the old `DiscordUserId`/`bigint` columns.
   - Test it with the Phase 0 Postgres fixture against a synthetic database shaped like production: habits, logs, day marks, a paused habit, a user without habits. Include a test that a migrated user can sign in with Discord and sees their habits.
   - The migration safety rule applies (dump, then Nico's go). The `Down` migration is not a rollback once web-only users exist; rollback means restoring the dump.
3. **`src/Ember.Api`** (ASP.NET Core 10, minimal APIs).
   - `MapIdentityApi<User>()`: register, login, refresh, confirm email, forgot and reset password. Browsers use cookies (`useCookies=true`, antiforgery); mobile uses bearer tokens (`AddBearerToken`).
   - `IEmailSender<User>` through an SMTP provider (Nico supplies credentials as env vars; never commit them).
   - Endpoints, all scoped to the signed-in user: habits CRUD, check-in and backfill, day marks, stats (streak, X-of-7, weekly), reminders, settings, export, delete account.
   - Rate limiting on auth endpoints, lockout on, HTTPS only, CORS restricted to the web origin. Health endpoint `/health`.
   - `Ember.Api` never runs migrations and hosts no scheduled jobs.
   - **Hosting until Phase 8:** run the API (and later the web app) on the homeserver as a new container, exposed only on the tailnet via `tailscale serve` (HTTPS, never `funnel`). That gives the Discord OAuth redirect a real HTTPS URL and lets Nico do the Phase 6 week of side-by-side use. Each deploy needs Nico's go.
4. **Discord linking and login.**
   - "Sign in with Discord" and "Link Discord" use OAuth2 scope `identify` through a maintained ASP.NET Core Discord handler (for example the AspNet.Security.OAuth.Providers package; verify the current version), then `UserManager.AddLoginAsync`.
   - From the bot side, `/link` only posts the web app's link page. No one-time codes.
5. **Account merge.** If linking hits a Discord ID that already has a bot-only account:
   - show what will move (habits, logs and day marks);
   - on confirmation, reassign them to the signed-in account and delete the empty bot-only user, in one transaction;
   - the signed-in account's settings (timezone, grace, opt-in) win, and the confirmation screen says so;
   - keep both habits when names collide;
   - never merge two accounts that both have a password.
6. **Passkeys:** later, after the web app is live. .NET 10 has the Identity passkey APIs but no SPA endpoints, so they need custom endpoints.
7. **Tests:** integration tests with `WebApplicationFactory` and the Phase 0 Postgres fixture. Cover auth flows, per-user data isolation (user A can never read user B's data), the merge, and delete-account cascade.

Acceptance: a bot-only user, a web-only user and a merged user all work. @security-reviewer review of auth, linking, merge and data isolation is **required** before Phase 8.

## Phase 6: Web app (installable PWA)

1. `web/`: an Angular app (current stable, standalone components, signals, `inject()`, no NgModules) using the Angular service worker (installable PWA).
2. Screens:
   - sign up, log in, reset password;
   - **Today** (one-tap check-in per habit);
   - **History** (calendar grid per habit, tap to backfill, mark low day);
   - **Habit edit** (name, frequency, reminder, pause, grace);
   - **Settings** (timezone with autodetect, linked Discord, export, delete account);
   - **Legal pages**.
3. Tone and design follow Ember's principles: no red, no "missed" counters, softer copy after a quiet week. Use the `impeccable` and `ui-ux-qa` skills: WCAG AA, keyboard navigation, reduced motion, works at 360 px width.
4. **Reminders on web:** Web Push (VAPID) as a second `IReminderChannel`, used by the due-reminder loop in the bot process (Phase 2.4) to reach subscribed browsers. The API only stores push subscriptions. On iOS this only works for an installed home-screen PWA (iOS 16.4+). Scheduled local notifications don't exist in browsers, so reminders on the web are server push only.
5. **Reminder channels per user:** Discord DM, web push, mobile (Phase 7). Each habit reminder goes to the channels the user selected; the default is the channel the habit was created from. No duplicate pings.
6. **Serving:** `Ember.Api` serves the built static files (one container), or an nginx container. Pick the simpler one, which is probably the API.
7. **Tests:** component tests only where logic exists (date grid, timezone display). Add Playwright e2e for the four critical journeys: sign up → first habit → check-in; backfill last week; link Discord; delete account.

Acceptance: Nico uses the web app and Discord side by side for a week with identical data.

## Phase 7: Mobile app (Capacitor)

1. Wrap the same Angular app with **Capacitor 8** (`mobile/` or inside `web/`; Node 22+ is required). No separate UI codebase.
2. **Local notifications** (`@capacitor/local-notifications`): reminders are scheduled on the device from the synced reminder settings, so they fire offline. Android 12+ needs `SCHEDULE_EXACT_ALARM`. Reschedule after sync, timezone change and app start.
3. Optional later: server push through FCM/APNs, only if local scheduling proves unreliable.
4. **Store requirements (both stores):**
   - privacy policy URL in the store and in the app;
   - in-app account deletion (exists since Phase 5);
   - treat habit data as health data in the privacy labels (Apple 5.1.1/5.1.3), and fill in Google Play's Health apps declaration.
   - Accounts: Apple Developer Program $99/year and Google Play $25 once. Nico creates and pays for these.
5. Android first (cheaper, faster review), then iOS.
6. No in-app purchases in v2 (see Phase 10).

Acceptance: reminders fire with the phone in airplane mode, and a check-in made offline syncs once the phone is back online.

## Phase 8: Hosting and public launch (N7)

1. **VPS (D6):** one EU VPS running Docker Compose with `api` (serving web), `bot` and `postgres`, plus a reverse proxy with automatic TLS (Caddy). Only ports 80/443 open, SSH by key only, firewall, unattended security upgrades.
2. **Deploy:** reuse `homeserver-deploy` with a second shim config pointing at the VPS. Change deploy logic in that tool, not in Ember. Keep the PruneDirs rule.
3. **Backups:** nightly encrypted `pg_dump` to off-site storage, with a documented and tested restore.
4. **Cut-over:**
   - Freeze the homeserver bot, dump, restore on the VPS, verify row counts, switch the bot token to the VPS instance, smoke-test, and keep the homeserver dump for 30 days.
   - Every step needs Nico's explicit go: production data, the token and DNS.
5. **Observability:** health checks, container restart policy, structured logs, and an uptime ping. Optional error tracking (Sentry free tier) with PII scrubbing.
6. **Launch checklist:**
   - Phases 1–7 accepted, and the security review done;
   - legal texts published, and a support contact (an email or a small Discord server);
   - bot profile with description and links;
   - Discord verification and privileged-intent review are needed only at Discord's thresholds. Ember uses no privileged intents, so check the current thresholds at the time.

## Phase 9: Desktop companion (conditional, D4)

The installed PWA already gives desktop users an app window and notifications. Build a native companion **only if** Nico wants one of these, which a PWA can't do:
- a tray icon with one-click check-in;
- a global hotkey;
- reminders that fire while the browser is closed.

If so, use **Tauri 2** wrapping the same Angular build. Tray support comes from the `tray-icon` feature. Reminders still come from the server (Tauri's notification plugin has no scheduling) or a small native timer. Linux tray click events aren't emitted, so ship Windows and macOS first.

## Phase 10: Ember+ (later, D2 and D5)

- The free core stays complete: unlimited backfill, low days, reminders, export and deletion are never paywalled.
- Ember+ ideas: deeper stats, themes, more than N habits, custom reminder sounds.
- **Payments:** Stripe Billing on the web. At €2.50 a fixed 50¢ fee makes merchant-of-record providers cost about 20%; Stripe is about 12% before VAT handling. VAT stays Nico's responsibility with Stripe, so confirm Stripe Tax or a tax adviser first.
- **Mobile:** don't sell inside the apps at first. Store rules on linking out to web payment differ by region (EU link-out terms since 1 Oct 2026; the US is in litigation), so check them at the time.
- The license change (D2) has to happen before the first paid user.

---

## How to execute this plan

- Follow `AGENTS.md` and Nico's global rules: lazy senior dev (smallest change that does the job), the test value bar, and commit at every checkpoint.
- **One branch per phase** (`v2/phase-1-bugfixes`, …). Commit at each checkpoint, push the branch at milestones, merge to `main` when the phase's acceptance is met and CI is green.
- Run the full suite once per phase end; run focused tests per slice.
- **Never without Nico's explicit go:** deploying to the homeserver or VPS, running migrations against production data, changing the bot token, DNS or Discord app settings, creating store or payment accounts, deleting branches, or publishing the legal texts.
- **Reviews by risk:**
  - Phases 1–3: a code-reviewer per phase.
  - Phases 2 (erasure and export) and 5 (auth, linking, merge, data isolation): @security-reviewer.
  - The Phase 5 migration: an adversarial review (@momus) before it runs anywhere real.
  - The web and mobile UI: the `ui-ux-qa` checklist and one live browser check.
- At each phase end, report to Nico: what changed, the test counts, open risks, and any decision from the table that has become due.
- Use synthetic data in tests only. Never log habit names or tokens.
