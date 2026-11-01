# Ember API contract v1.1

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
| 422 | `before_habit_start` / `in_future` | Day outside the editable range |
| 429 | `rate_limited` | Too many attempts; `Retry-After` header set |
| 500 | `internal` | No detail leaks |

- Every endpoint acts only on the signed-in user. Another user's habit ID behaves exactly like a missing one (404).
- Consent gating follows Core exactly: an endpoint returns `consent_required` where the Core call does (`AddHabitAsync` throws `ConsentRequiredException`; any `DayEditResult.ConsentRequired`), and also for `POST /api/account/merge`. Reads, settings, export and delete never need consent.
- Every `/api` response has `Cache-Control: no-store`. The app sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` with `default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` (Angular injects inline styles), and HSTS outside Development.

## Auth

Browser: cookie auth. Mobile (Phase 7): bearer tokens from `/api/auth/login` and `/api/auth/refresh`; Discord sign-in is browser-only in v2.

### Antiforgery

- `GET /api/auth/antiforgery` → 204 and sets the `XSRF-TOKEN` cookie (readable by JS). The token is tied to the signed-in identity, so the client fetches it on app start, after login, after Discord sign-in and after logout.
- The browser sends it as the `X-XSRF-TOKEN` header on every POST, PUT, PATCH and DELETE (Angular `HttpClient` does this by default).
- Enforced on every unsafe request authenticated by the cookie scheme → 403 `antiforgery`. Exempt: anonymous JSON-only auth POSTs (register, login, resendConfirmationEmail, forgotPassword, resetPassword) and bearer-authenticated requests.

### Identity endpoints (`/api/auth`)

These keep ASP.NET Core Identity's response shapes:

- `POST /api/auth/register` `{ email, password }` → 200 for any well-formed request, whether or not the email is taken (a taken address gets an "already registered" email instead). 400 `validation` problem with Identity error codes as `errors` keys (`PasswordTooShort`, `InvalidEmail`, ...) for a bad password or email. Password rule: at least 10 characters, no composition rules.
- `POST /api/auth/login?useCookies=true` or `?useSessionCookies=true` (when "stay signed in" is off) `{ email, password }` → 200 and the cookie. Failure: 401 problem whose `detail` is `Failed`, `NotAllowed` (email not confirmed) or `LockedOut`. The client shows these as a login error, not as a session expiry. Without either flag it returns `{ tokenType, accessToken, expiresIn, refreshToken }`.
- `POST /api/auth/refresh` `{ refreshToken }` → new tokens.
- `GET /api/auth/confirmEmail?userId&code` → 200, or 401 for a bad or expired code.
- `POST /api/auth/resendConfirmationEmail` `{ email }` → 200 always.
- `POST /api/auth/forgotPassword` `{ email }` → 200 always.
- `POST /api/auth/resetPassword` `{ email, resetCode, newPassword }` → 200, or 400 `validation` problem.
- `/api/auth/manage/*` is not exposed (404). No email or password change in v2 besides reset.

Custom:

- `POST /api/auth/logout` → 204, clears the cookie.

Identity options: confirmed email required to sign in, unique emails, lockout after 5 failures for 15 minutes. Security stamp changes on password reset, Discord link, unlink and merge; cookies revalidate the stamp every 5 minutes.

Emails link to the web app, built from the configured `Ember__WebOrigin` (never the request host), with URL-encoded values: `{WebOrigin}/confirm-email?userId=…&code=…` and `{WebOrigin}/reset-password?email=…&code=…`. The web pages call the API and then remove `code` from the address bar.

Rate limits on `/api/auth/*`: per client IP (after forwarded headers), plus per email address on the mail-sending endpoints (register, resendConfirmationEmail, forgotPassword).

### Discord

- OAuth2 scope `identify`. The callback path is exactly `/api/auth/discord/callback`; the full redirect URI registered with Discord is `{WebOrigin}/api/auth/discord/callback`.
- `GET /api/auth/discord/login?returnUrl=/today` → challenge. On return:
  - a known Discord ID signs in its account (migrated and bot-only users included);
  - an unknown Discord ID creates an account through Core `ResolveOrCreateDiscordUserAsync` (the same bot-only shape) and signs it in;
  - redirects to `returnUrl` when it is a local path (starts with a single `/`, not `//` or `/\`, and contains no control characters, raw or percent-encoded such as `%09`), else `/today`.
- `GET /api/auth/discord/link` (signed in) → challenge. The flow is bound to the user who started it; on return, a different or missing signed-in user ends at `/settings?discord=error`. Otherwise it redirects to:
  - `/settings?discord=linked` when the Discord ID was free (login added) or already this account's;
  - `/link/merge` when the Discord ID belongs to a bot-only account (no password, no email). A pending merge is stored in a data-protected, HttpOnly cookie bound to the signed-in user's ID and security stamp, valid 15 minutes, used once;
  - `/settings?discord=conflict` when it belongs to an account with a password, or this account already has a different Discord login.
- Any OAuth failure (user cancelled, `access_denied`, remote error) redirects to `/login?discord=error` (login flow) or `/settings?discord=error` (link flow).
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
    "graceDaysPerWeek": 1, "leaderboardOptIn": false,
    "consent": { "given": true, "policyVersion": "2026-10", "currentPolicyVersion": "2026-10" },
    "dmReminders": { "paused": false }
  }
  ```
  `email` is null for accounts created through Discord. `discord.id` is null when not linked.
- `PATCH /api/me` `{ timezone?, graceDaysPerWeek? (0–3), leaderboardOptIn? }` → 200 `Me`. Unknown IANA zone → 400.
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
- `GET /api/stats/weekly` → `{ totalDone, totalPossible, headline, footer, habits: [{ habitId, name, done, possible, streak }] }` for the 7 days ending yesterday (Core `WeeklySummaryService`). `headline` and `footer` are plain text: Discord markdown stripped, emoji kept. `streak` is null for weekly habits.

## Web push (Phase 6 server slice)

- `GET /api/push/vapid-public-key` → `{ key }`.
- `POST /api/me/push-subscriptions` `{ endpoint, keys: { p256dh, auth } }` → 204. `endpoint` must be `https` on a known push service host (Google FCM, Mozilla, Microsoft WNS, Apple); anything else → 400. An endpoint already stored for another account moves to the caller (shared device). At most 10 per account.
- `DELETE /api/me/push-subscriptions?endpoint=<url-encoded>` → 204, only the caller's own. The web app calls it before logout.
- `Habit.reminderChannels`: `("discord" | "webpush")[]`, settable via `PATCH /api/habits/{id}`. Default: `discord` for habits created in the bot or before this slice, `webpush` for habits created in the web app. Empty means no reminders. A channel the user can't receive (no Discord login, no push subscription) is skipped silently.
- Notification payload (Angular service worker shape): `{ "notification": { "title": "Ember", "body": "<text>", "data": { "onActionClick": { "default": { "operation": "navigateLastFocusedOrOpen", "url": "/today" } } } } }`. The body names no habit by default ("A gentle nudge from Ember"), since it can show on a lock screen.
- Until the slice lands these return 501 and `reminderChannels` is absent; the web app hides push settings on 501.

## Health

- `GET /health` → 200 when the API and database are reachable.

## Test host (team `api` produces, team `web` and the department lead consume)

A runnable host in the test tree, never in `src/` or the Docker image: `dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:<port>`. It starts a throwaway Postgres container, applies the migrations, runs the real API with:

- the real Discord OAuth handler, with Discord's token and user endpoints faked at the backchannel HTTP boundary. `GET /test/discord/next?id=<discordId>` sets the Discord ID the next authorization returns. The authorize step redirects straight to the callback.
- a captured outbox instead of SMTP: `GET /test/outbox?email=<address>` returns the latest email's links.
- `POST /test/users/bot-only` `{ discordId, habitStartDate? }` creates a bot-only user with one habit (for the merge journey). `habitStartDate` (`yyyy-MM-dd`) backdates that habit's creation so past days can be backfilled; omitted means today.
