# Ember API contract v1.14

v1.14 (2026-11-12, Nico: "It should be limited to pictures, but not one. Maybe up to 5 with a combined size of like at most 10mb or something?", and: "the feedback should give the options for a title, a description, attachments and it should auto send the version, the time at which it was sent and the user that sent it. ... unless they choose to be anonymous."): feedback has a title, up to 5 pictures and an anonymous option, in the apps and in Discord; pictures stay on the server until the report is handled, and the digest names their ids only. See "Feedback pictures v1.14".

v1.13 (2026-11-12, Nico: "Well we can change that, no?", and on the email: "we should probably make it so resend sends it like once a day or something, if something new exists."): in-app feedback from the web app, the Android app and Discord (`POST /api/feedback`, `/feedback`), mailed to the operator in one daily digest when there is new feedback. See "Feedback v1.13".

v1.12 (2026-11-11, after v1.11, Nico: "we need the option to set when that happens throughout the day"): a habit has several reminder times a day (`reminderTimes`), up to its `timesPerDay`; `POST /api/habits` takes `reminderChannels`. See "Reminder times v1.12".

v1.11 (2026-11-11, Nico: "We can also make the mail send you a code that you just add in the app instead of using your password"): the confirmation email carries a 6-digit code; entering it (or opening the emailed link) confirms the email and signs in (`POST /api/auth/confirm-email-code`). See "Sign-up code v1.11".

v1.10 (2026-11-11, Nico: "Done action on reminders outside Discord"): one-tap Done on single-habit web push reminders through a one-time token (`POST /api/reminders/done`); push subscriptions follow their sign-in session. See "Reminder Done v1.10".

v1.9 (2026-11-11, Nico: "Android Discord sign-in"): the Android app signs in with Discord through the system browser, PKCE and a one-time code (`POST /api/auth/discord/native/token`). See "Native Discord sign-in".

v1.7 follow-up (2026-11-03): enabling 2FA and importing a journal key need the login password; import, merge and body details pinned from team backend's defaults.

v1.7 (2026-11-03, Nico: "I still want all of them to exist"): three levels of privacy. No account (data only on the device), an account (synced, the default), and an account with an end-to-end encrypted private journal (opt-in). Two-factor sign-in (TOTP). Importing device data into a new account. See "Privacy levels v1.7".

v1.6 (2026-11-03, Nico: "do all 5"): the leaderboard is gone; flexible schedules (set weekdays, several times a day); routines; a journal for the day with moods; day stats for the year view; native "Done" from a reminder and an Android home-screen widget. See "Features v1.6". Defaults marked *(default)* are the department lead's until Nico says otherwise.

v1.5 (2026-11-03): bearer access tokens live 15 minutes; a password reset lifts a lockout; mail limits per client IP, per address across clients and per day; request bodies are capped at 64 KiB.

v1.4 (2026-11-02, Nico): the theme is an account setting synced across devices; an account without a chosen timezone takes the device's zone automatically.

v1.3 (2026-11-01): auth rate limits cover only credential and mail endpoints; native app (Capacitor) origins and bearer flow; `mobile` reminder channel; offline day edits.

v1.2 (2026-11-01): login never reports `LockedOut` (a locked account answers `Failed`); email confirmation needs the account's password, so a confirmation link can't activate a password someone else chose.

v1.1 (2026-11-01): CSP allows inline styles, `returnUrl` rejects control characters, static serving includes `/legal/*.md`, test host seeding takes `habitStartDate`.

Shared interface between `src/Ember.Api` (producer, team `api`) and `web/` (consumer, team `web`). Changes go only through the department lead and bump the version.

## Conventions

- Same origin. All endpoints live under `/api`, except `GET /health`. In production the API also serves the built web app; static files include `/legal/*.md` (served as `text/markdown`), and its SPA fallback to `index.html` never applies to `/api/**` or `/health` (an unknown `/api` path is a JSON 404).
- Ports: the API listens on `http://localhost:5080` (team `api`) or `5081` (team `web`'s own runs); the Angular dev server proxies `/api` to it.
- JSON with camelCase names. Dates are local calendar days as `yyyy-MM-dd`, times of day as `HH:mm`, instants as ISO 8601 UTC. Enums are lowercase strings.
- Errors are RFC 7807 problem details (`application/problem+json`). Apart from the Identity endpoints listed below, `type` holds one of these codes:

| HTTP | `type` | Meaning |
| --- | --- | --- |
| 400 | `validation` | Bad input; `errors` maps field name to messages |
| 401 | `unauthenticated` | Not signed in (never a redirect) |
| 403 | `forbidden` | Signed in but not allowed |
| 403 | `consent_required` | Health-data consent for the current policy version is missing; the client shows the consent step |
| 403 | `antiforgery` | Missing or wrong `X-XSRF-TOKEN` |
| 404 | `not_found` | Missing, or belongs to another user (never reveal which) |
| 409 | `habit_limit` | 25 habits already |
| 409 | `conflict` | Linking, unlinking or merge not allowed; `detail` is a short user-facing reason |
| 401 | `invalid_code` | An emailed sign-up code that didn't work, for any reason (v1.11) |
| 410 | `expired` | A reminder action token that can no longer be used (v1.10) |
| 422 | `before_habit_start` / `in_future` | Day outside the editable range |
| 429 | `rate_limited` | Too many attempts; `Retry-After` header set |
| 500 | `internal` | No detail leaks |

- Every endpoint acts only on the signed-in user. Another user's habit ID behaves exactly like a missing one (404).
- Consent gating follows Core exactly: an endpoint returns `consent_required` where the Core call does (`AddHabitAsync` throws `ConsentRequiredException`; any `DayEditResult.ConsentRequired`), and also for `POST /api/account/merge`. Reads, settings, export and delete never need consent.
- `POST` and `DELETE` endpoints that take a JSON body need at least `{}` even when every field is optional (for example `journal-key/turn-off`); without a body they answer 404.
- Every `/api` response has `Cache-Control: no-store`. The app sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` with `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-ancestors 'none'`, and HSTS outside Development.

## Auth

Browser: cookie auth. Mobile (Phase 7): bearer tokens from `/api/auth/login` (or `/api/auth/discord/native/token`) and `/api/auth/refresh`.

### Native app (Phase 7)

- The Capacitor app runs the same Angular build from the origins `https://localhost` (Android) and `capacitor://localhost` (iOS). CORS allows these in addition to `Ember__WebOrigin`, configurable as `Ember__NativeOrigins` (comma-separated, exact origins only, `*` rejected), with `Authorization` and `Content-Type` headers and without credentials; only the web origin gets credentials. These origins identify nothing (every Capacitor Android app is `https://localhost`); auth is the bearer token alone.
- The native app uses bearer tokens only: `POST /api/auth/login` without cookie flags, then `POST /api/auth/refresh`. It sends `Authorization: Bearer`, never cookies, so antiforgery doesn't apply. The access token lives in memory only; the refresh token only in the platform's secure storage (Android Keystore-backed, iOS Keychain), never in `localStorage` or Preferences. On a 401 the app refreshes once (single flight) and retries. The native build calls the absolute `{WebOrigin}` API base; the web build stays relative and same-origin.
- Bearer tokens belong to a server-side session like cookies (see Sessions below): logout with the bearer token ends that session, and its access and refresh tokens stop working at once. A refresh token also fails once its session ends. Native logout and account delete wipe the stored tokens and the device's local state for that user (scheduled notifications, cached habits, queued offline edits).
- Discord link and merge are browser-only in v2. The app's Settings shows the Discord state and opens `{WebOrigin}/settings` in the system browser to link, and re-reads `GET /api/me` when the app resumes. Discord sign-in works in the app (see "Native Discord sign-in" under Discord).
- Sign-up, confirm and reset links open the web app (`{WebOrigin}`); the user then signs in in the app.

### Antiforgery

- `GET /api/auth/antiforgery` → 204 and sets the `XSRF-TOKEN` cookie (readable by JS). The token is tied to the signed-in identity, so the client fetches it on app start, after login, after Discord sign-in and after logout.
- The browser sends it as the `X-XSRF-TOKEN` header on every POST, PUT, PATCH and DELETE (Angular `HttpClient` does this by default).
- Enforced on every unsafe request authenticated by the cookie scheme → 403 `antiforgery`. Exempt: anonymous JSON-only auth POSTs (register, login, confirmEmail, confirm-email-code, resendConfirmationEmail, forgotPassword, resetPassword) and bearer-authenticated requests.

### Identity endpoints (`/api/auth`)

These keep ASP.NET Core Identity's response shapes:

- `POST /api/auth/register` `{ email, password }` → 200 for any well-formed request, whether or not the email is taken (a taken address gets an "already registered" email instead). 400 `validation` problem with Identity error codes as `errors` keys (`PasswordTooShort`, `InvalidEmail`, ...) for a bad password or email. Password rule: at least 10 characters, no composition rules.
- `POST /api/auth/login?useCookies=true` or `?useSessionCookies=true` (when "stay signed in" is off) `{ email, password }` → 200 and the cookie. Failure: 401 problem whose `detail` is `Failed` (wrong credentials, or the account is locked; the two are indistinguishable on purpose) or `NotAllowed` (email not confirmed). The client shows these as a login error, not as a session expiry. Without either flag it returns `{ tokenType, accessToken, expiresIn, refreshToken }`.
- `POST /api/auth/refresh` `{ refreshToken }` → new tokens.
- `POST /api/auth/confirmEmail` `{ userId, code, password }` → 200 and the email is confirmed (the client then signs in normally). 401 problem for a bad or expired code or a wrong password (indistinguishable). Rate-limited like login and counted towards lockout. The web page `/confirm-email` asks for the password the user chose at sign-up and links to forgot-password; a successful password reset through the emailed code also confirms the email. `GET` on this path is not supported. Kept for links in emails sent before v1.11; newer emails carry the sign-up code instead (see "Sign-up code v1.11").
- `POST /api/auth/resendConfirmationEmail` `{ email }` → 200 always. Mails a new sign-up code that replaces the old one (v1.11).
- `POST /api/auth/forgotPassword` `{ email }` → 200 always.
- `POST /api/auth/resetPassword` `{ email, resetCode, newPassword }` → 200, or 400 `validation` problem.
- `/api/auth/manage/*` is not exposed (404). No email or password change in v2 besides reset.

Custom:

- `POST /api/auth/logout` → 204, clears the cookie and ends this device's session only (cookie or bearer); other devices stay signed in. Anonymous → 204, no-op.
- `POST /api/auth/logout-everywhere` → 204, same shape and antiforgery rule as logout: ends every session of the account (this device included) and rotates the security stamp. Anonymous → 204, no-op.
- **Sessions.** Every sign-in (password, 2FA, Discord; cookie or bearer) creates a server-side session whose ID travels in the `ember:sid` claim of the cookie and of both bearer tokens. A cookie, access token or refresh token is accepted only while its session exists and hasn't expired (checks cached up to 60 s in the API process, dropped at once when a session ends); one without the claim, issued before sessions existed, is rejected, so its holder signs in again. A session lives 14 days, like the cookie and the refresh token, and slides forward while in use; a user keeps at most 50, and a new sign-in ends the oldest beyond that. Expired sessions are deleted daily. A new cookie sign-in (password, 2FA or Discord) on a browser that already has a session ends that session. A password reset ends every session; turning 2FA on or off, linking or unlinking Discord and an account merge end every other session and keep the current one (cookie or bearer, refresh token included). Starting 2FA setup (`/me/2fa/setup`, a new authenticator key while 2FA is off) ends no session. Account deletion ends every session at once, and a merge ends every session of the merged-away account; the data export doesn't include sessions.

Identity options: confirmed email required to sign in, unique emails, lockout after 5 failures for 15 minutes; a successful password reset lifts the lockout. Security stamp changes on password reset, Discord link, unlink and merge; cookies revalidate every 5 minutes, and the cookie and refresh token are accepted whatever their stamp while their session is live (sessions are what signs devices out).

Emails link to the web app, built from the configured `Ember__WebOrigin` (never the request host), with URL-encoded values: `{WebOrigin}/confirm-email?userId=…&code=…` and `{WebOrigin}/reset-password?email=…&code=…`. The web pages call the API and then remove `code` from the address bar.

Rate limits: per client IP (after forwarded headers) on the credential endpoints only (register, login, refresh, confirmEmail, confirm-email-code, resendConfirmationEmail, forgotPassword, resetPassword), plus on the mail-sending ones (register, resendConfirmationEmail, forgotPassword): per endpoint, email address and client IP (5 per hour), per email address across clients (20 per hour), per client IP (10 per hour) and in total (200 per day), each answering 429 `rate_limited`. Every other `/api/auth` request (antiforgery, logout, the Discord redirect steps, and any endpoint added later) falls under a loose per-IP cap of 300 per minute instead.

### Discord

- OAuth2 scope `identify`. The callback path is exactly `/api/auth/discord/callback`; the full redirect URI registered with Discord is `{WebOrigin}/api/auth/discord/callback`.
- `GET /api/auth/discord/login?returnUrl=/today` → challenge. On return:
  - a known Discord ID signs in its account (migrated and bot-only users included);
  - an unknown Discord ID creates an account through Core `ResolveOrCreateDiscordUserAsync` (the same bot-only shape) and signs it in;
  - redirects to `returnUrl` when it is a local path (starts with a single `/`, not `//` or `/\`, and contains no control characters, raw or percent-encoded such as `%09`), else `/today`.
- `POST /api/auth/discord/link/start` `{ password }` (signed in, antiforgery) → 204 and a link grant: an opaque, HttpOnly, SameSite=Strict cookie (Secure outside Development) for `/api/auth/discord/link`, bound to the signed-in user, valid 5 minutes, used once. A wrong password answers 400 `validation` on `password` and counts toward lockout (a locked-out account gets the same answer); rate-limited like the 2FA endpoints. 409 `conflict` for an account without a password.
- `GET /api/auth/discord/link` (signed in) → challenge. An account with a password needs a link grant first; the request consumes it, and without a valid one (missing, expired, used or another user's) it redirects to `/settings?discord=password` instead. An account without a password (it signed up with Discord) needs no grant. The flow is bound to the user who started it; on return, a different or missing signed-in user ends at `/settings?discord=error`. Otherwise it redirects to:
  - `/settings?discord=linked` when the Discord ID was free (login added) or already this account's;
  - `/link/merge` when the Discord ID belongs to a bot-only account (no password, no email). A pending merge is stored in a data-protected, HttpOnly cookie bound to the signed-in user's ID and security stamp, valid 15 minutes, used once;
  - `/settings?discord=conflict` when it belongs to an account with a password, or this account already has a different Discord login.
- Any OAuth failure (user cancelled, `access_denied`, remote error) redirects to `/login?discord=error` (login flow) or `/settings?discord=error` (link flow).

#### Native Discord sign-in (Android app)

- The app makes a PKCE verifier (32 random bytes, base64url, kept in memory only) and opens the system browser at `{WebOrigin}/api/auth/discord/login?client=native&challenge=<base64url SHA-256 of the verifier>`. `returnUrl` is not sent; the app keeps it. A challenge that isn't 43 base64url characters redirects straight to the error below.
- The Discord flow runs in the browser with the same callback (`{WebOrigin}/api/auth/discord/callback`, no extra redirect URI at Discord) and the same accounts rule as the web: a known Discord ID is its account, an unknown one creates the bot-only shaped account. Nothing signs the browser in. It ends in a redirect to the fixed app URL `app.ember.habits://auth/discord?code=<code>` (never a URL from the request); a cancel or failure ends at `app.ember.habits://auth/discord?error=discord`.
- The code is 32 random bytes (base64url, 43 characters), kept only as a SHA-256 hash in the API process's memory, bound to the user and the challenge, valid 2 minutes, one exchange at a time. The app accepts only that exact URL with exactly one `code` (43 base64url characters) or `error` parameter while a sign-in it started is pending, and ignores any other URL.
- `POST /api/auth/discord/native/token` `{ code, verifier, twoFactorCode?, twoFactorRecoveryCode? }` (anonymous, no antiforgery, rate-limited like login) → 200 with the same bearer token response as `POST /api/auth/login` (`tokenType`, `accessToken`, `expiresIn`, `refreshToken`), with a new session. An unknown, used or expired code, or a verifier whose SHA-256 isn't the challenge, answers 401 `Failed`; a wrong verifier or an expired code also ends the code. Once used, the code is gone.
- An account with 2FA: the exchange without a code answers 401 `RequiresTwoFactor`, keeps the code and gives it 5 minutes; the app asks for the second factor and repeats the exchange with the same code and verifier plus `twoFactorCode` or `twoFactorRecoveryCode`. A wrong code answers 401 `Failed`, keeps the code and counts toward lockout as on `POST /api/auth/discord/2fa`; a locked-out account answers `Failed`.
- Android: `MainActivity` (`singleTask`) has a `VIEW`/`BROWSABLE` intent filter for `app.ember.habits://auth/discord`; the app listens with `@capacitor/app` `appUrlOpen` and closes the browser. Another app can claim the same scheme and see the code, which PKCE makes useless to it. PKCE does not stop a malicious app from starting its own flow with its own verifier and receiving the code for an account whose owner approves it in the browser (client impersonation, RFC 8252 §8.6); a verified Android App Link (`https` redirect plus `/.well-known/assetlinks.json` with the release signing certificate) closes that and is planned before a public Play release.
- `DELETE /api/me/discord` → 204. 409 `conflict` unless the account has a password and a confirmed email (otherwise it could no longer sign in).

### Account merge

- `GET /api/account/merge` → 200 `{ habits: int, logs: int, dayMarks: int, habitNames: string[], kept: { timezone, graceDaysPerWeek, leaderboardOptIn } }`, or 404 when no valid merge is pending. `kept` is the signed-in account's settings, which win.
- `POST /api/account/merge` → 204. Needs consent on the signed-in account. In one transaction, after re-checking that the source is still bot-only, the Discord login still points at it and the signed-in account still has no Discord login:
  - moves habits and their logs to the signed-in account; both habits stay when names collide; the 25-habit limit does not block a merge;
  - moves day marks, keeping one when both accounts marked the same day;
  - moves the Discord login, deletes the now-empty bot-only account, reschedules reminders in the signed-in account's timezone, and consumes the pending merge.
  - 404 when nothing valid is pending; 409 `conflict` when a re-check fails.
- `DELETE /api/account/merge` → 204, cancels.

## Me

- `GET /api/me` →
  ```json
  {
    "id": "guid", "email": "a@b.c", "emailConfirmed": true, "hasPassword": true,
    "discord": { "linked": true, "id": "123" },
    "timezone": "Europe/Berlin", "timezoneSet": true, "localToday": "2026-11-01",
    "graceDaysPerWeek": 1, "theme": null,
    "consent": { "given": true, "policyVersion": "2026-11", "currentPolicyVersion": "2026-11" },
    "dmReminders": { "paused": false }
  }
  ```
  `email` is null for accounts created through Discord. `discord.id` is null when not linked.
- `PATCH /api/me` `{ timezone?, graceDaysPerWeek? (0–3), theme? }` → 200 `Me`. Unknown IANA zone → 400. (`leaderboardOptIn` was removed in v1.6; a PATCH that still sends it is not an error, the field is ignored.)
- `theme` is the account's theme id: `hearthlight`, `fieldnotes`, `tidepool`, `marigold`, or null (never chosen; the app shows the default, Hearthlight). A PATCH sets it to one of those ids; any other value → 400 `validation`. A PATCH without `theme` leaves it unchanged. The bot ignores it; export includes it.
- Clients (web and native): after sign-in, when `timezoneSet` is false, the app sends `PATCH /api/me { timezone }` once with the device's IANA zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) if the server knows it; a failure is ignored and retried on the next app start. A zone the user picked (`timezoneSet: true`) is never changed automatically.
- `POST /api/me/consent` `{ policyVersion }` → 204. 400 when it isn't the current version.
- `POST /api/me/dm-reminders/resume` → 204.
- `GET /api/me/export?format=json|csv` → file download. Same content as the bot's `/export`, plus the account's email and Discord ID (and, after the push slice, reminder channels and push subscription endpoints).
- `POST /api/me/delete` `{ password?, confirm: "DELETE" }` → 204, deletes everything, signs out. Needs the current password when the account has one; otherwise the typed `confirm` value. 400 `validation` on a mismatch.

## Habits

`Habit`:

```json
{
  "id": 1, "name": "Water", "frequency": "daily", "weeklyTarget": null,
  "reminderTime": "09:00", "pausedFrom": null, "pausedUntil": null, "pausedToday": false,
  "createdAt": "2026-10-01T08:00:00Z", "startDate": "2026-10-01",
  "today": { "date": "2026-11-01", "state": "pending", "completed": null },
  "stats": { "streak": 4, "graceUsed": 0, "bestStreak": 9, "last7": 5, "week": { "done": 2, "target": 3 } }
}
```

- `state` is one of `beforestart`, `done`, `notdone`, `pending`, `lowday`, `paused` (Core `DayState`). The web app never renders `notdone` as "missed" or in red; it is just an empty day.
- Daily habits: `stats.streak`, `graceUsed` and `bestStreak` from Core `ConsecutiveStreak` and `BestStreak`; `last7` from `FlexibleStreak`; `week` is null.
- Weekly habits: `stats.streak`, `graceUsed` and `bestStreak` are null; `week` from `WeeklyProgress`; `last7` as for daily habits.

Endpoints:

- `GET /api/habits` → `Habit[]`.
- `GET /api/habits/{id}` → `Habit`.
- `POST /api/habits` `{ name (1–100 chars after trimming), reminderTime?, frequency, weeklyTarget? (1–6, weekly only) }` → 201 `Habit`.
- `PATCH /api/habits/{id}` `{ name?, reminderTime?, clearReminder?, frequency?, weeklyTarget? }` → 200 `Habit`. All fields are validated before anything is written.
- `DELETE /api/habits/{id}` → 204.
- `POST /api/habits/{id}/pause` `{ until: "yyyy-MM-dd" | null }` → 200 `Habit`. `null` resumes (Core `PauseHabitAsync` rules). `until` before the user's local today → 400.
- `GET /api/habits/{id}/days?from=yyyy-MM-dd&to=yyyy-MM-dd` → `[{ date, state, completed }]`, oldest first. Default: the 14 days ending today. At most 366 days per request; any past day back to the habit's start can be fetched.
- `PUT /api/habits/{id}/days/{date}` `{ completed: bool }` → 200 `Habit`. Check-in and backfill.
- `DELETE /api/habits/{id}/days/{date}` → 200 `Habit`. Clears the day.
- `GET /api/habit-templates` → `[{ key, name, description, suggestedReminderTime: "HH:mm", frequency, weeklyTarget }]` from Core `HabitTemplates` (`name` is `DisplayName` with its emoji; `weeklyTarget` is null for daily templates).

## Low days and stats

- `GET /api/low-days?from&to` → `string[]` of dates (default: the last 366 days).
- `PUT /api/low-days/{date}` → 204. `in_future` after the local today, `before_habit_start` before the user's earliest habit start. `DELETE /api/low-days/{date}` → 204.
- `GET /api/stats/weekly` → `{ totalDone, totalPossible, headline, footer, habits: [{ habitId, name, done, possible, streak }] }` for the 7 days ending yesterday (Core `WeeklySummaryService`). `headline` and `footer` are plain text: Discord markdown stripped, emoji kept. `streak` is null for weekly habits. When nothing was possible that week (`totalPossible` 0, Core `HasSummarableWeek` false, the bot sends no summary), `headline` and `footer` are empty strings.

## Web push (Phase 6 server slice)

- `GET /api/push/vapid-public-key` → `{ key }`.
- `POST /api/me/push-subscriptions` `{ endpoint, keys: { p256dh, auth } }` → 204. `endpoint` must be `https` on a known push service host (Google FCM, Mozilla, Microsoft WNS, Apple); anything else → 400. An endpoint already stored for another account moves to the caller (shared device). At most 10 per account.
- `DELETE /api/me/push-subscriptions?endpoint=<url-encoded>` → 204, only the caller's own. The web app calls it before logout.
- `Habit.reminderChannels`: `("discord" | "webpush" | "mobile")[]`, settable via `PATCH /api/habits/{id}`. Default: `discord` for habits created in the bot or before this slice, `webpush` for habits created in the web app. Empty means no reminders. A channel the user can't receive (no Discord login, no push subscription) is skipped silently. `mobile` is never dispatched by the server: the native app schedules local notifications on the device for habits that have it, so they fire offline. Turning on "Remind me on this phone" for a habit sets its channels to `mobile` only (replacing `discord` and `webpush`), so the same reminder never arrives twice; the UI says so. Turning it off restores the channels this device remembered for the habit, or else `discord` when the account has Discord, else `webpush` (the server doesn't store the creation channel). Adding `discord` or `webpush` to a `mobile` habit removes `mobile`.
- Notification payload (Angular service worker shape): `{ "notification": { "title": "Ember", "body": "<text>", "data": { "onActionClick": { "default": { "operation": "navigateLastFocusedOrOpen", "url": "/today" } } } } }`. The body names no habit by default ("A gentle nudge from Ember"), since it can show on a lock screen.
- Until the slice lands these return 501 and `reminderChannels` is absent; the web app hides push settings on 501.

## Health

- `GET /health` → 200 when the API and database are reachable.

## Test host (team `api` produces, team `web` and the department lead consume)

A runnable host in the test tree, never in `src/` or the Docker image: `dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:<port>`. It starts a throwaway Postgres container, applies the migrations, runs the real API with:

- the real Discord OAuth handler, with Discord's token and user endpoints faked at the backchannel HTTP boundary. `GET /test/discord/next?id=<discordId>` sets the Discord ID the next authorization returns. The authorize step redirects straight to the callback.
- a captured outbox instead of SMTP: `GET /test/outbox?email=<address>` returns the latest email's links.
- `POST /test/users/bot-only` `{ discordId, habitStartDate? }` creates a bot-only user with one habit (for the merge journey). `habitStartDate` (`yyyy-MM-dd`) backdates that habit's creation so past days can be backfilled; omitted means today.

## Offline day edits (Phase 7, also used by the PWA)

- The client queues `PUT`/`DELETE /api/habits/{id}/days/{date}` made while offline (keyed by user ID) and replays them in order once online. The server needs no change and replays are idempotent. "Last write wins" means last replayed: an older offline edit can overwrite a newer edit made elsewhere, accepted for v2.
- Dates are computed in the account's timezone (`me.timezone`), not the device's.
- A replay is dropped (with a gentle notice) only on 404, 422 `before_habit_start`/`in_future`, or 400 `validation` (a body the server can no longer accept, for example after the habit changed shape); it never blocks the queue.
- Day notes: a queued day-note edit refused with 400 because the journal changed form in between (queued as plaintext, journal now private, or the reverse) is never silently lost. The client converts it to the journal's current form (encrypts it with the unlocked key, or decrypts it while turning off) and replays it; if it can't right now (journal locked on this device), it moves out of the queue into a held list that doesn't block later edits and is replayed after the next unlock. Any other 400 drops it with the gentle notice, which shows the text so the user can copy it. On `consent_required` it stays queued and the app shows the consent step. On 401, 429, 5xx or network failure it stays queued and is retried.

## Features v1.6

Producer: team `backend` (`src/Ember.Core`, `src/Ember.Bot`, `src/Ember.Api`, migrations, `tests/`). Consumer: team `clients` (`web/`, `mobile/`). Every new user-data table cascades on account delete, is included in both export formats (JSON and CSV), and is merged by account merge like habits are.

### Leaderboard removal

- The bot's `/leaderboard` command, its help text and `User.LeaderboardOptIn` are removed; a migration drops the column. Export no longer has `leaderboard_opt_in` / `leaderboardOptIn`. The web settings toggle and the merge page's leaderboard mention go. Privacy texts (`docs/legal`, the bot's privacy module) drop the leaderboard.

### Schedules

`Habit` gains:

```json
{ "frequency": "daily" | "weekly" | "weekdays", "days": ["mon","wed","fri"] | null, "timesPerDay": 1 }
```

- `weekdays`: `days` lists 1–6 distinct weekdays (`mon`…`sun`, any order in, Monday-first order out); all seven is rejected (use `daily`). `days` is null for `daily` and `weekly`.
- A day that isn't in `days` has the new state `offday`: nothing is expected, it can still be checked in (it then counts as `done`), it is never `pending` or `notdone`, and streaks step over it (it neither extends nor breaks a streak). Grace days apply to scheduled days only.
- `timesPerDay` 1–10 for `daily` and `weekdays` (always 1 for `weekly`). A day carries `count` (0…timesPerDay). The day is `done` when `count >= timesPerDay`; a day with `0 < count < timesPerDay` has the new state `partial`. Streaks count `done` days only; `partial` days count as "showed up" in day stats.
- Day objects (`today` and `GET .../days`) gain `count`: `{ date, state, completed, count }`. `completed` stays (true when done, false when explicitly not done, null otherwise).
- `PUT /api/habits/{id}/days/{date}` accepts `{ completed: bool }` (unchanged: true sets `count = timesPerDay`, false sets `count = 0` and marks not done) or `{ count: int }` (absolute; a count above `timesPerDay` is clamped to it, so a queued offline edit still lands after the target was lowered; a negative count → 400). Absolute values keep offline replays idempotent. `DELETE` clears the day as before.
- `POST`/`PATCH /api/habits` accept `frequency`, `days`, `timesPerDay`, `weeklyTarget` with the rules above; an invalid combination → 400 `validation` naming the field. Changing `timesPerDay` never takes a done day away: a day that reached its target when it was checked in stays `done` (stored with the day), and a past day whose count reaches a lowered target counts as done too. Only today's day is recomputed against the new target. A checked-in offday counts as `done` and extends the streak like any done day.
- Bot: shows `2/3` style progress for multi-count habits, its check-in button adds one (capped), and the habit setup offers weekdays and times per day. Offdays show as rest, never as missed. Weekly summary and DM reminders skip offdays.
- Reminders (all channels) fire only on scheduled days, and not once the day is `done`.

### Routines

```json
{ "id": 1, "name": "Morning", "reminderTime": "07:30" | null, "reminderChannels": ["mobile"], "habitIds": [3, 1] }
```

- `GET /api/routines` → `Routine[]`. `POST /api/routines` `{ name (1–50 after trimming), reminderTime?, reminderChannels?, habitIds? }` → 201. `PATCH /api/routines/{id}` (any of those, `clearReminder?`) → 200. `DELETE /api/routines/{id}` → 204 (its habits stay, ungrouped). At most 10 routines per user → 409 `conflict`.
- `habitIds` is ordered and sets membership: a habit belongs to at most one routine; listing it moves it from its old routine. Unknown or foreign ids → 404. `Habit` gains `routineId: int | null`.
- *(default)* While a habit is in a routine with a reminder, the routine's reminder replaces the habit's own (the habit keeps its `reminderTime` for when it leaves the routine; the UI shows it as overridden). A routine reminder fires once per scheduled day for the member habits that are still `pending` or `partial`, and not at all when none are.
- Channels work as for habits (`discord`, `webpush` dispatched by the server; `mobile` scheduled by the app). A routine created without `reminderChannels` gets `webpush`, like a habit created on the web; the native app sends `["mobile"]` when the user picks "Remind me on this phone". The Discord DM may list the pending habit names with check-in buttons (DMs are private). Web push uses the generic body.
- Routines are in the export and merge; the bot doesn't manage routines (web and app only). Routine writes need no consent.

### Journal for the day (Nico: free text, five moods plus your own)

```json
{ "date": "2026-11-03", "text": "Slept badly, still went for a walk." | null, "mood": "okay" | "custom:4" | null }
```

- One entry per account per local day, not per habit. `text` is free text, 1–2000 chars after trimming (line breaks kept), or null. At least one of `text`/`mood` is set; a PUT with both null deletes the entry.
- `mood` is one of the five built-ins `low`, `meh`, `okay`, `good`, `great`, or `custom:<id>` for one of the user's own moods.
- Own moods: `GET /api/moods` → `[{ id, label, emoji, archived }]`; `POST /api/moods` `{ label (1–24 chars after trimming), emoji? (one emoji grapheme or null) }` → 201; `PATCH /api/moods/{id}` `{ label?, emoji?, archived? }` → 200. At most 20 non-archived moods → 409 `conflict`. There is no hard delete: archiving hides a mood from the picker while past days keep showing it. A day can't be set to an archived or foreign mood → 400 `validation`.
- `GET /api/day-notes?from&to` → `DayNote[]` oldest first (default and maximum: 366 days). `PUT /api/day-notes/{date}` `{ text?, mood? }` → 200 `DayNote` (absolute, so offline replays are idempotent). `DELETE /api/day-notes/{date}` → 204.
- Same date rules as low days (`in_future`, `before_habit_start`) for new entries; rewriting an entry that already exists (for example its form while the private journal is switched on or off) is always allowed, even if the habits that dated it are gone; writes need consent (`consent_required`), reads don't. A `PUT` with both `text` and `mood` null deletes the entry and answers 200 `{ date, text: null, mood: null }`.
- Never shown by the bot, in any notification, or in the weekly summary. Entries and own moods are included in export, delete and merge (on merge, own moods with the same label are combined).
- Offline: the client queues `PUT`/`DELETE /api/day-notes/{date}` exactly like day edits (moods are edited online only).

### Day stats (year view)

- `GET /api/stats/days?from&to` → `[{ date, scheduled, done, partial, showedUp }]` oldest first (default: the 366 days ending today; maximum 366). Per local day across all habits: `scheduled` = habits expected that day (started, not paused, not offday), `done` / `partial` = how many reached each state, `showedUp` = true when any habit has a check-in that day (any `count > 0` or `completed: true`, offdays included). Weekly habits count as scheduled every day. Range rules as for `/api/habits/{id}/days` (`to` after today → 400).
- The client words it gently ("you showed up 18 of the last 30 days"); never "missed", never red.

### Native: check in from a reminder, home-screen widget (clients only)

- *(default)* A per-device setting "Show habit names in reminders", off by default. Off: reminders keep the generic body and only open the app. On: the title names the habit (or routine), and single-habit reminders get a "Done" action.
- Local notification `extra`: `{ "userId", "habitId" | "routineId", "date" }`. "Done" opens the app, which adds one to that habit's count for `date` (absolute `PUT { count }` through the offline queue) and shows a short confirmation. A stale or foreign `extra` (other user, deleted habit) just opens Today.
- Android widget "Today in Ember": today's scheduled habits for the signed-in user with their state (up to 6, then "+N more"). Tapping a habit opens the app and adds one, like "Done"; tapping elsewhere opens Today. The app pushes a snapshot to the widget after every habit change and clears it on sign-out, session end and account delete. The widget receives only explicit, immutable intents; extras are validated (numeric habit id, ISO date, matching user) before anything is written.

## Privacy levels v1.7

### Private journal (end-to-end encrypted, opt-in)

Encryption happens only in the client (WebCrypto, available in the browser and the Android WebView). The server stores and returns opaque blobs and never sees a key, passphrase or recovery code.

- **Keys.** Enabling the private journal makes a random 256-bit journal key (AES-GCM). It is wrapped twice: by a key derived from a **journal passphrase** the user chooses (PBKDF2-SHA256, 600,000 iterations, 16-byte random salt; the UI recommends a passphrase different from the login password), and by a key derived from a **recovery code** shown once (128 random bits, shown as 8 groups of 4 Crockford base32 characters; HKDF-SHA256 with its own salt). A login password change or reset never touches the journal key.
- **Crypto details (fixed for cross-device compatibility).** Passphrases are Unicode NFC-normalized before PBKDF2. Wrapping is AES-GCM over the raw 32-byte journal key with a 12-byte random IV (`iv`, `wrapped`), no AAD. The recovery code is normalized (uppercase, strip spaces and dashes, `I`/`L` → `1`, `O` → `0`), decoded to its 16 bytes and run through HKDF-SHA256 with a 16-byte random salt and info `ember-journal-recovery-v1`. Entries and moods use AES-GCM with a fresh 12-byte IV each time; the AAD is `ember-day-note:v1:<date>` for entries (so a stored entry can't be moved to another day) and `ember-mood:v1` for own moods. Encrypted reads look like `{ "date", "encrypted": { "v", "iv", "ct" } }` and `{ "id", "encrypted", "archived" }`.
- `GET /api/me/journal-key` → 404 when the private journal is off, else `{ "version": 3, "passphrase": { "salt", "iterations", "iv", "wrapped" }, "recovery": { "salt", "iv", "wrapped" } }` (all binary fields base64). `version` increments on every change.
- `PUT /api/me/journal-key` with that shape (without `version`) plus `{ "password"?: string, "ifVersion"?: int }` → 200 with the stored shape. Creating needs no `ifVersion`; replacing (new passphrase, new recovery code) needs the current `ifVersion` (mismatch → 409 `conflict`). Accounts with a login password must send it on create and replace (wrong → 400 `validation`). Discord-only accounts can't be locked out of their own data this way because replacing needs the same session plus `ifVersion`.
- **Turning it off.** `POST /api/me/journal-key/turn-off` `{ password? }` → 200: the key stays (so devices can still decrypt), `GET /api/me/journal-key` gains `"turningOff": true`, and plaintext writes are accepted again alongside encrypted ones. The client decrypts and re-uploads every entry and own mood as plaintext, then calls `DELETE /api/me/journal-key` `{ password?, discardEncrypted: false }` → 204 (409 `conflict` while any encrypted entry or mood remains). While `Me.journal.turningOff` is true, any device *offers* to finish the turn-off and re-uploads plaintext only after the user confirms with the login password (never automatically: a compromised server could otherwise set the flag and collect the journal in plaintext). Finishing an interrupted switch-on (`plaintextLeft > 0`) stays automatic, since it only encrypts. "I lost both passphrase and recovery code": `DELETE` with `discardEncrypted: true` deletes every encrypted entry and own mood with the key, in any state. All of these need the login password when the account has one.
- **Encrypted entries.** While a journal key exists and isn't turning off, `PUT /api/day-notes/{date}` must be `{ "encrypted": { "v": 1, "iv", "ct" } }` (base64; `ct` is AES-GCM over the UTF-8 JSON `{ "text", "mood" }`; at most 16 KiB base64); a plaintext body → 400 `validation`. Own moods likewise: `POST`/`PATCH /api/moods` take `{ "encrypted": {...}, "archived"? }` with `ct` over `{ "label", "emoji" }`. Reads return entries and moods in whichever form they're stored. Built-in mood keys only ever appear inside the ciphertext then.
- **Switching on.** `Me` gains `journal: { "encrypted": bool, "turningOff": bool, "plaintextLeft": int, "encryptedLeft": int }`. After creating the key, the client encrypts every existing plaintext entry and own mood (PUT/PATCH each); if it's interrupted, the next unlock on any device finishes the job while `plaintextLeft > 0`.
- **Unlocking.** Each device unlocks once with the passphrase or the recovery code. The native app keeps the unwrapped key in secure storage (Android Keystore); the web app keeps it as a non-extractable `CryptoKey` in IndexedDB when "remember on this device" is ticked, otherwise in memory. Sign-out, session end and account delete forget it. Using the recovery code makes the user choose a new passphrase (re-wrap, `PUT` with `ifVersion`).
- **Export and merge.** Server export includes the encrypted blobs and the wrapped key as stored; the app offers "Export my journal (decrypted)" built on the client. Account merge moves encrypted entries and moods unchanged; if both accounts have a journal key the merge is refused with 409 `conflict` and a short reason.
- What stays readable to the server, by design: email, Discord ID, habit and routine names (the bot and reminders need them), check-ins and their times, low days.

### Two-factor sign-in (TOTP)

- `GET /api/me/2fa` → `{ "enabled": bool, "recoveryCodesLeft": int }`.
- `POST /api/me/2fa/setup` → `{ "sharedKey", "authenticatorUri" }` (otpauth URI, issuer `Ember`); repeating it replaces an unconfirmed key.
- `POST /api/me/2fa/enable` `{ "code", "password"? }` → `{ "recoveryCodes": string[10] }` shown once; wrong code → 400 `validation`. Accounts with a login password must send it (wrong or missing → 400 on `password`), so a stolen session alone can't turn 2FA on and lock the owner out. Discord-only accounts enable with the code alone (no password exists; accepted risk until Nico decides otherwise).
- `POST /api/me/2fa/disable` `{ "password"?, "code"? }` → 204 (the login password, or for Discord-only accounts a current code); with 2FA already off → 204 without changes.
- `POST /api/me/2fa/recovery-codes` `{ "code" }` → `{ "recoveryCodes": string[10] }`, replacing the old ones.
- Sign-in: `POST /api/auth/login` accepts `twoFactorCode` or `twoFactorRecoveryCode`. A correct password without a code answers 401 with `detail: "RequiresTwoFactor"` (only after the password was right, so it reveals nothing new); a wrong code counts toward lockout like a wrong password. Discord sign-in for an account with 2FA ends on `/login?step=2fa` (keeping a safe `returnUrl`: `/login?step=2fa&returnUrl=…`) and needs the code too (`POST /api/auth/discord/2fa` `{ code? , recoveryCode? }`). Native bearer sign-in sends the code in the same login call; native Discord sign-in sends it with the one-time code.
- 2FA is independent of the private journal: it protects the login, not the content.

### No account (device only)

Client only (team `local`), except the import endpoint below.

- The welcome screen offers "Use Ember without an account". Everything (habits, check-ins, low days, routines, journal, moods, settings) lives on the device: IndexedDB on the web, the same in the Android WebView. Nothing is sent to the server; no Discord, no sync, no web push. The native app's local reminders, "Done" action and widget work as with an account.
- The rules (day states including `offday` and `partial`, streaks, grace days, weekly progress, routines, day stats) run in the client (`web/src/lib/local/`), matching Core. Parity tests use shared fixtures in `docs/contracts/fixtures/rules-v1.json` (produced by team `backend` from Core: inputs plus expected states and stats).
- The app warns clearly, once and in settings: the data exists only on this device; browsers may delete site data (Safari after 7 days without a visit; installing the PWA helps); uninstalling the app deletes it. It offers "Export backup" and "Import backup" (the server's JSON export format, v1.7) and a gentle backup reminder every 30 days.
- "Create an account and keep my data": after sign-up, the client uploads the device data with `POST /api/me/import` (body: the JSON export format; only into an account with no habits, else 409 `conflict`; 25-habit limit applies; needs consent; validated like the individual endpoints; all or nothing). The local copy is removed after a successful import. With the private journal chosen at sign-up, the journal is encrypted before upload.

### Export format v2 (JSON export, backup files and `POST /api/me/import`)

snake_case like today, plus `"format_version": 2` at the top level (an export without it is the old format; import accepts only 2). Existing sections (`settings`, `habits`, `logs`, `day_marks`, `account`, push data) keep their names. Additions:

- `habits[]`: `days` (`["mon",…]` or null), `times_per_day`, `routine_id` (or null), `routine_position` (or null).
- `logs[]`: `count`.
- `routines`: `[{ id, name, reminder_time, reminder_channels }]` (membership lives on the habits).
- `moods`: `[{ id, label, emoji, archived }]` or, when encrypted, `[{ id, encrypted: { v, iv, ct }, archived }]`.
- `day_notes`: `[{ date, text, mood }]` or, when encrypted, `[{ date, encrypted: { v, iv, ct } }]`.
- `journal_key`: `{ passphrase: { salt, iterations, iv, wrapped }, recovery: { salt, iv, wrapped } }` or null.
- Ids in a file are only references inside that file; import assigns new ids and remaps `routine_id`, log `habit_id` and `custom:<id>` moods inside plaintext notes. `account`, push subscriptions, DM state and consent fields are ignored on import.
- The CSV export gets the matching columns and record types; import is JSON only.
- A `journal_key` in an import needs the login password inside it (`journal_key.password`) on accounts that have one, like `PUT /api/me/journal-key` (wrong or missing → 400 on `password`).
- Before importing, the client sends `PATCH /api/me { timezone }` with the device's zone (as for any new account); otherwise a first-day log can fall before a habit's start and the whole import is refused.
- Import answers 204. On account merge, the signed-in account's day note wins when both accounts have one for the same date, and same-label plaintext moods are combined.
- `POST /api/me/import` accepts bodies up to 5 MiB (signed-in callers only) and `POST /api/feedback` up to 14 MiB for signed-in callers (v1.14); every other endpoint, and anonymous feedback, keeps the 64 KiB cap. Larger → 413.
- Upgrading with the private journal chosen: the client imports everything except `moods` and `day_notes` (sent empty, since the server can't remap mood ids inside ciphertext), then creates the journal key and uploads encrypted moods and entries through the journal endpoints. No plaintext journal data is ever sent. The local copy stays until every step succeeded, and a retry resumes where it stopped.

## Reminders v1.8

v1.8 (2026-11-10, Nico): old reminder buttons disappear once they can no longer be used, so the reminder message means something; and an optional second reminder for people who did the task but forgot to tap. Defaults marked *(default)* are the department lead's until Nico says otherwise.

### Reminder buttons close (Discord)

- A Discord reminder (habit or routine) keeps its buttons from the moment it is sent until the first of:
  1. 10:00 local time on the day after the reminder's local day (`MissedDayReflectionJob.LocalSendHour`, when the "Log yesterday" check-in takes over) *(default)*;
  2. every habit on it being done for that day, logged anywhere (bot, web, app, widget);
  3. a second reminder for the same habit or routine and day being sent (see below);
  4. the user tapping a button on it (as today).
- Closing removes every button and keeps the text, adding one subtext line: `-# ✅ Logged.` when its habits are done for that day, `-# This reminder has closed.` otherwise. A message superseded by a second reminder is deleted instead (closed as above if deleting fails).
- The bot remembers each reminder message it sent (Discord channel and message id, user, habit or routine, local day) only until that message is closed; the record is then removed. It is deleted with the user, habit or routine and is not part of the export.
- Done and Skip on a reminder no longer work forever: tapping them after rule 1 answers ephemerally `This reminder has closed. You can still fill in that day with /habit history or on the web. 💙` and closes the message. This also covers messages sent before v1.8 (no record exists for them). Snooze keeps its own window.
- Closing is best effort: a message Discord can't edit (deleted by the user, DMs closed) just drops its record.

### Second reminder (all channels)

- New account setting `secondReminderMinutes`: `0` (off, the default), `15`, `30`, `60` or `120`. One setting for all of the user's habit and routine reminders *(default: per account, not per habit)*.
- When it is on, every regular reminder that was sent is followed once, that many minutes later, by a second reminder on the same channels, but only if, at that moment, the habit is still not done for that local day (a routine: at least one member habit still pending or partial), the habit isn't paused, the local day hasn't changed since the first reminder, and it isn't stale (same `StaleAfter` rule). Never a third.
- A snooze replaces the pending second reminder (the user picked their own time). A second reminder is never sent for a snoozed reminder.
- Discord text for a habit: `🔔 One more nudge for **{name}**, in case the first one got buried. Did you get to it today?` with the usual Done / Skip / Snooze buttons. Routine: `🔔 One more nudge for your **{routine}** routine. Still open today:` plus the list and Done buttons as in the first one. The first message is deleted (see above).
- Web push: same as the first reminder's payload, body `One more nudge, in case the first one got buried.`
- `GET /api/me` gains `"secondReminderMinutes": 0`. `PATCH /api/me` accepts `secondReminderMinutes`; any other value → 400 `validation` on `secondReminderMinutes`; absent leaves it unchanged.
- Bot: `/habit second-reminder` with one required choice (`Off`, `15 minutes`, `30 minutes`, `1 hour`, `2 hours`), answering ephemerally in Ember's tone, like `/habit grace`.
- Export: `settings.second_reminder_minutes`; import accepts it (missing → 0, invalid → 400 `validation`). The CSV export gets the matching column.
- Native app: schedules a second local notification `secondReminderMinutes` after each planned reminder, for the same habit or routine and date, same title and "Done" action, body `One more nudge, in case the first one got buried.`, dropped when it would fall on another local day. Both go away together when the day is checked in (the plan already drops done days). No-account mode keeps the setting on the device, with the same choices, and uses it for these local notifications only.
- Web and app Settings: a "Second reminder" control (Off, 15 minutes, 30 minutes, 1 hour, 2 hours) in the reminder area, explained in one gentle line: `If you haven't checked in yet, Ember nudges you once more.`

## Reminder Done v1.10

v1.10 (2026-11-11, Nico: "Done action on reminders outside Discord", including on Android with habit names hidden): a single-habit reminder can be checked off from the notification on web push and in the native app, while the notification still names no habit.

### Web push payload

- A single-habit reminder (first or second, not a routine) adds a "Done" action and a one-time token; the rest of the payload is unchanged and the title stays `Ember`:
  `{ "notification": { "title": "Ember", "body": "<text>", "actions": [{ "action": "done", "title": "Done ✅" }], "data": { "onActionClick": { "default": { "operation": "navigateLastFocusedOrOpen", "url": "/today" } }, "doneToken": "<token>" } } }`. A routine reminder has neither `actions` nor `doneToken`.
- The service worker shows the action. Tapping the notification itself still opens `/today`. Tapping "Done" posts `{ token }` to `POST /api/reminders/done` without cookies and without opening the app; on 204 it shows a notification titled `Ember` with the body `Logged. Nice work. ✅` (no habit name); on any other answer or a network failure it opens `/today`.

### Tokens

- The bot creates one random 256-bit token (base64url, 43 characters) per sent reminder, shared by the user's push subscriptions. The database stores only its SHA-256 hash, with the user, habit and the reminder's local day; a lookup is by hash. Tokens are never logged.
- Only push subscriptions registered by a sign-in session that is still live (not ended, not expired) get the token; any other subscription (saved before v1.10, or its session expired) gets the plain nudge without "Done".
- A token expires when the reminder's Discord buttons would (10:00 local time on the day after the reminder's day, `ReminderDispatchJob.IsExpired`), works once, and is deleted with the user or habit. An account merge moves them with the habits. Expired tokens are purged by the daily account cleanup job. Not part of the export.

### Push subscriptions follow their session

- `POST /api/me/push-subscriptions` records the caller's session with the subscription (re-registering updates it).
- Ending a session server-side (logout, logout everywhere, a password reset, a security change that signs out the other devices, account delete, merge, signing in again over an existing session, the 50-session cap) deletes the push subscriptions that session registered, whether or not the client unsubscribed. Logout everywhere, a password reset and every other "end all sessions" also delete every push subscription not registered by the session that stays (including ones saved without a session) and all of the account's Done tokens.
- On logout the web app closes the Ember notifications still showing before it unsubscribes.

### `POST /api/reminders/done`

- Anonymous, antiforgery-exempt (the token is its own secret), rate-limited per client IP like the credential endpoints. Body `{ "token": "<token>" }`.
- Applies the same rule as the Discord "Done" button: adds one check-in to that habit on the token's day (capped at `timesPerDay`), with the usual day rules and the health-data consent.
- 204: logged now, or the token was already used (nothing is added again). A write that doesn't land (rejected or failed) leaves the token unused. 404 `not_found`: unknown, missing or malformed token, or its habit is gone. 410 `expired`: the token expired or its day can't be logged (for example before the habit's start). 403 `consent_required`: no current consent; nothing is written and the token stays usable.

### Native app

- Replaces the v1.6 rule that only named reminders get "Done": every single-habit local notification has the "Done" action, whether or not "Show habit names in reminders" is on; with names off the title stays `Ember` and the body generic. Routine reminders still have none.
- Android opens the app for a notification action (Capacitor 8 LocalNotifications starts an activity for every action), so "Done" adds one to that habit for the notification's `date` as before, then lands on Today with the short confirmation.

## Sign-up code v1.11

v1.11 (2026-11-11, Nico: "you have to go back to sign in and sign in again, effectively putting your password in 3 times before you get in. We can reduce that. We can also make the mail send you a code that you just add in the app instead of using your password."): the confirmation email's code confirms the email and signs in, without the password.

### Email

- Sent on register and on `resendConfirmationEmail`. Carries a 6-digit numeric code on its own line and the link `{WebOrigin}/confirm-email?user=<userId>&code=<6 digits>`. Plain text: "Welcome to Ember." / "Your code:" / the code / "Enter it in Ember to confirm your email address and sign in, or open this link:" / the link / "The code works for 15 minutes. If you didn't create an Ember account, you can ignore this email."
- A code works for 15 minutes and for 5 tries (right or wrong). Sending a new code replaces the old one and resets the tries; a burned or expired code needs `resendConfirmationEmail`. The server stores only the code's SHA-256 hash.
- Links in emails sent before v1.11 (`/confirm-email?userId=…&code=…`) still go to `POST /api/auth/confirmEmail` with the password.

### `POST /api/auth/confirm-email-code`

- Anonymous, antiforgery-exempt, rate-limited like login. Body `{ email?, userId?, code }`: one of `email` (as typed in the app) or `userId` (the link's `user`); `userId` wins when both are sent.
- `?useCookies=true` (web) → 200 and a persistent cookie, as `/login?useCookies=true`. Without it (native app) → 200 `{ tokenType, accessToken, expiresIn, refreshToken }`, as `/login`. Either way the email is confirmed and a sign-in session starts exactly as on a password sign-in. The client then continues with the normal consent step.
- Only for an account whose email is not yet confirmed; a confirmed account is never signed in by a code.
- Every failure (unknown account, wrong, expired, burned or replaced code, already confirmed) → the same 401 problem, `type` `invalid_code`, `detail` "That code didn't work. Check the newest email or send a new code." The answer never reveals whether an account exists.
- 2FA on → the same `invalid_code` (a code never gets around 2FA).

### Same device only

Nico chose "Same device only": the code alone signs in only on the device that signed up, so nobody can pre-register someone else's address with their own password and have the owner unknowingly activate it.

- The client makes a random `signupKey` (32 random bytes, base64url) when the sign-up form is submitted, keeps it with the sign-up email for 24 hours, and sends it as the header `X-Ember-Signup-Key` on `POST /api/auth/register` and `POST /api/auth/resendConfirmationEmail`. The server stores only its SHA-256 hash next to the code. Only `register` binds the code to the key it was sent with; a resend keeps the binding when it sends the same key and otherwise drops it (the new code then needs the password), so a resend can't tie a code to another device. Values over 128 characters or not base64url count as none.
- `POST /api/auth/confirm-email-code` takes `signupKey?` and `password?`. A valid code signs in when the key matches the stored hash, or else with the account's password.
- Valid code, no matching key, no password → 401 problem `type` `password_required`, `detail` "Enter your password to finish on this device." It counts as a try. A valid code with a wrong password → `invalid_code`, also a try (the code's 5 tries are the limit, so this doesn't add to the account's lockout). A locked-out account gets `invalid_code`.

## Reminder times v1.12

`Habit` gains:

```json
{ "reminderTimes": ["08:00", "13:00", "20:00"] }
```

- `reminderTimes`: `"HH:mm"` local times, sorted ascending, without repeats, 0 to `timesPerDay` entries (so never more than 10; weekly habits have at most 1). Empty means no reminder. `reminderTime` stays in responses as the first entry, or null, for older clients.
- `POST /api/habits` and `PATCH /api/habits/{id}` take `reminderTimes?: string[]`. When present it wins and `reminderTime` is ignored; an empty array clears the reminder. A request with only `reminderTime` sets `[reminderTime]` (on PATCH this replaces all times), and PATCH `clearReminder: true` clears them all. Input in any order is accepted and stored sorted. 400 `validation` on `reminderTimes`: an entry that isn't `HH:mm`, a repeated time, more entries than the habit's `timesPerDay` (the request's `timesPerDay` when it sends one), or `reminderTimes` combined with `clearReminder: true`.
- Lowering `timesPerDay` (also by switching to `weekly`) keeps the earliest `timesPerDay` times. A PATCH that sends both `timesPerDay` and `reminderTimes` checks the times against the new `timesPerDay`.
- Dispatch: the next reminder is the next of any of the times in the user's timezone. Each time sends like a single reminder (same channels, buttons, Done token, skip rules): only while the day is still open (`count < timesPerDay`), not paused and scheduled. A second reminder (v1.8) still follows a delivered regular reminder, but is skipped when the habit's next regular reminder comes first or at the same time. Routines keep one `reminderTime`; a habit in a routine with a reminder still sends none of its own.
- Weekly habits: a reminder (regular or second) is sent only on a day without a check-in yet and while the week's `weeklyTarget` isn't reached, counting check-ins in the user's local Monday–Sunday week, the same week as the weekly progress. Once the target is met, its reminders stay quiet until the next Monday; the next reminder time still advances day by day.
- The native app schedules one local notification per entry for habits with the `mobile` channel.
- Discord shows all times (`Reminders: 08:00, 13:00, 20:00 your time` in `/habit list`). Setting a reminder in Discord still sets one time: it replaces all of the habit's times with it, and the bot's reply names the times it replaced when there were several.
- Export: JSON `habits[]` gains `reminder_times` (`["08:00:00", …]`, sorted; `reminder_time` stays as the first). The CSV `reminder_time` column of a habit row lists all times joined with `;`. Import reads `reminder_times` (wins) or else `reminder_time`; more distinct times than the habit's `times_per_day` → 400 on `reminder_times`. Account merge moves habits with their times.
- `POST /api/habits` also takes `reminderChannels?` with the same values and validation as `PATCH /api/habits/{id}` (`discord`, `webpush`, `mobile`; empty means no reminders; an unknown value → 400 `validation`). Without it a web-created habit gets `webpush`, as before.

## Feedback v1.13

### `POST /api/feedback`

- Anonymous or signed in (cookie or bearer); outside the signed-in group. A signed-in caller's account is stored with the feedback, else none. Cookie-authenticated calls need `X-XSRF-TOKEN` like every other cookie POST; anonymous and bearer calls don't.
- Body `{ "text": string, "platform": "web" | "android", "version"?: string | null }`. Unknown members are ignored and never stored.
- `text`: trimmed, then 1 to 2000 UTF-16 code units, without control characters other than tab, line feed and carriage return, without bidi controls (U+202A to U+202E, U+2066 to U+2069) and without unpaired surrogates. `platform`: exactly `web` or `android` (`discord` is the bot's only). `version`: when present, 1 to 32 characters of `0-9 A-Z a-z . + _ -`.
- 204 on success. 400 `validation` with errors on `text`, `platform` or `version`. 429 `rate_limited` with `Retry-After`.
- Rate limits (`Ember:RateLimits`): `FeedbackPerHour` (default 5) per signed-in account; an anonymous sender per client IP (an IPv6 caller by its /64) and `FeedbackPerDay` (default 200) across all anonymous senders. Signed-in senders don't count toward and aren't stopped by that anonymous daily limit. The per-sender limit is taken first, so a sender over it doesn't use up the daily allowance. These limits are separate from the mail limits.
- Global cap: at most 300 feedback stored in any 24 hours across every platform (web, Android, Discord; the most one digest carries). Beyond it the API answers 429 `rate_limited` with `Retry-After: 3600` and stores nothing; the bot answers "Ember has had a lot of feedback today. 💙 Try again tomorrow."

### Discord `/feedback`

- Top-level command; opens a modal with one paragraph field (1 to 2000 characters). The text gets the same check as `text` above; an empty or invalid one gets a gentle ephemeral error. Stored with platform `discord`, no version, and the user's Ember account when the Discord user has one (none is created). The answer is ephemeral.
- At most 5 per Discord user per hour, in memory (a bot restart resets it): checked when the command opens the modal and counted on submit; over the limit the command answers ephemerally instead.

### Storage and retention

- Table `Feedback`: id, account (nullable), platform (`web`, `android`, `discord`), version, text, created and digested times. Deleted with the account; an account merge moves it to the target. Not part of the export.
- Feedback is deleted 12 months after it was submitted (on each digest run).

### Daily digest

- The API runs it every day at 08:00 Europe/Berlin (daylight saving included). A run missed while the API was down is caught up at the next 08:00. `Feedback:DigestEnabled=false` turns the schedule off (tests).
- Mails every pending feedback, oldest first, at most 300 per email, in one email to `Feedback:DigestTo` over the account-email SMTP settings (written as plain text; the transport also adds an HTML copy, in which links are clickable); nothing when none is pending. Without `Feedback:DigestTo` nothing is sent (logged once per process) and feedback stays pending.
- Subject `Ember feedback: {n} new`. The body opens with a line saying the feedback is written by users and links in it are untrusted, then per feedback, separated by `---`: `#{id} · {yyyy-MM-dd HH:mm Europe/Berlin} · {platform} {version or "unknown version"} · {signed in | no account}` and the text, every line prefixed with `> ` so it can't pose as a header or separator. With more than 300 pending it ends with `{N} more pending, they come with the next digest.` No account IDs or email addresses are in the mail.
- Only the feedback in a sent email is marked digested, after the send returns. A failed send is logged (without the content), then one alert email goes to the same recipient, subject `Ember feedback digest failed`, with only the pending count, the oldest item's age in hours and the error type (a failure of that is logged too); the feedback stays pending for the next day. Delivery is at least once: if marking fails after a successful send, those items come again.

## Feedback pictures v1.14

Replaces the parts of "Feedback v1.13" it names; the rest stays.

### `POST /api/feedback`

- Body `{ "title"?: string, "text": string, "platform": "web" | "android", "version"?: string | null, "images"?: string[], "anonymous"?: boolean }`.
- `title`: trimmed, 1 to 100 UTF-16 code units, the same character rules as `text`, and on one line (no line feed, carriage return, tab, U+2028 or U+2029: "Keep the title on one line."). Missing (app versions before v1.14) → the first line of the text, cut to 100. Present but empty → 400 "Required.".
- `anonymous: true` stores no account with the report, also for a signed-in caller. Signed out it changes nothing (already anonymous).
- `images`: signed-in callers only (anonymous or not), each a standard base64 string of one picture file, no `data:` prefix. At most 5, at most 10 MiB decoded together. The server decides the type by magic bytes, not by any declared type: JPEG, PNG or WebP only, still (no animated WebP), at most 4096 px per side. It removes metadata without decoding pixels: JPEG keeps only the segments needed to decode (APP14, DQT, DHT, DRI, SOF, SOS scans, at most 64), PNG keeps IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, sBIT, bKGD, pHYs (CRCs checked), WebP keeps VP8X (only the alpha flag), ALPH and VP8/VP8L. EXIF (also GPS), XMP, ICC, text chunks, the JFIF thumbnail and anything after the image end are gone. Pictures are stored in upload order.
- 400 `validation` on `images`: "Sign in to add pictures." (signed out), "Up to 5 pictures.", "One of the pictures is empty.", "Pictures can be up to 10 MB together.", "One of the pictures couldn't be read. Try another one.", "Ember can take JPEG, PNG or WebP pictures.", "That picture is too large, up to 4096 pixels per side.", "Ember can take still pictures only, no animations.". 400 on `title` as above.
- Body size: signed-in callers up to 14 MiB, everyone else 64 KiB (413 beyond). A signed-in body over 64 KiB first takes one of 2 server-wide upload slots and then a per-account permit (`FeedbackPerHour` per hour); without either → 429 `rate_limited` before the body is read. Such an upload must keep at least 50 KiB/s after 10 s, else the server drops it.
- Rate limits: a report with pictures counts as one feedback (`FeedbackPerHour` per account, 300 per 24 h across platforms). The per-account hourly permit is taken before pictures are decoded. Plus 30 MiB of pictures per account per 24 h (in memory, also for anonymous reports; a restart resets it) and 100 MiB of stored pictures across everyone per 24 h (database). Over a limit → 429 `rate_limited` with `Retry-After`, nothing stored.
- When the account no longer exists by the time the report is saved, it is stored without account and without its pictures.
- Clients: the web app and the Android app shrink each picture on the device first (longest side 1920 px, WebP, else JPEG on white), show the picker only with an account, and before sending pictures make sure the session is fresh; on 413 or "Sign in to add pictures." they refresh once and retry. A send with pictures waits up to 120 s.

### Discord `/feedback`

- Opens a modal: Title (1 to 100), "What would make Ember better?" (1 to 2000), a file upload (0 to 5 files) and "Send as" (with my Ember account, the default, or anonymously).
- Declared sizes over 10 MiB together or more than 5 files → gentle ephemeral error before downloading. Files are fetched only from `https://cdn.discordapp.com` or `https://media.discordapp.net` (default port, no redirects, 15 s for the whole download, read capped at the declared size), then get the same checks and stripping as the API. If any file isn't a JPEG, PNG or WebP picture, the whole report is refused with a gentle ephemeral message. 30 MiB of pictures per Discord user per 24 h, in memory.
- Stored with platform `discord`; with "anonymously", or when the Discord user has no Ember account, without account.

### Storage and retention

- `Feedback` gains `Title` (existing reports got the first line of their text) and `ResolvedAt` (null until handled). New table `FeedbackImages`: id (opaque UUID), report (cascade), content type, size, bytes (Postgres `bytea`).
- Pictures are deleted 30 days after their report is marked handled, and never kept past 12 months after the report (the daily digest run deletes them; a report is deleted after 12 months as before). Deleted with the account through the report, unless the report was anonymous (it has no link to the account). An account merge moves reports with their pictures. Not part of the export. No HTTP endpoint serves pictures.

### Daily digest

- No attachments. The header line ends with `signed in` or `anonymous` (was `no account`); the title follows as the first quoted line, then a lone `>` and the quoted text. A report with pictures ends with `Pictures: {id}, {id}`. No commands, paths or hostnames.

### Homeserver command (not HTTP)

Run from the Ember compose directory on the homeserver; documented in the README:

- `docker compose exec -T api dotnet Ember.Api.dll --list-feedback [--all]`: open reports (all with `--all`), oldest first, as text: id, created and resolved time (UTC), platform, version, `user {id}` or `anonymous`, quoted title and text, picture ids. Read-only.
- `tools/feedback-images.sh <out-dir> <id>...` (wraps `--feedback-images <id>...`): each id is a report id or a picture id; writes `{out-dir}/{reportId}/{pictureId}.{jpg|png|webp}`. Unknown ids are named on stderr; exit 1 when nothing was found.
- `docker compose exec -T api dotnet Ember.Api.dll --resolve-feedback <reportId>...`: marks reports handled now (a second call keeps the first time); unknown ids → exit 1.
