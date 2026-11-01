# Ember API contract v1

Shared interface between `src/Ember.Api` (producer, team `api`) and `web/` (consumer, team `web`). Changes go only through the department lead and bump the version.

## Conventions

- Same origin. All endpoints live under `/api`, except `GET /health`. In development the API listens on `http://localhost:5080` and the web dev server proxies `/api` to it. In production the API also serves the built web app with an SPA fallback to `index.html`.
- JSON with camelCase names. Dates are local calendar days as `yyyy-MM-dd`, times of day as `HH:mm`, instants as ISO 8601 UTC. Enums are lowercase strings.
- Errors are RFC 7807 problem details. `type` holds one of these codes:

| HTTP | `type` | Meaning |
| --- | --- | --- |
| 400 | `validation` | Bad input; `errors` maps field to messages |
| 401 | `unauthenticated` | Not signed in |
| 403 | `consent_required` | Health-data consent for the current policy version is missing; the client shows the consent step |
| 403 | `antiforgery` | Missing or wrong `X-XSRF-TOKEN` |
| 404 | `not_found` | Missing, or belongs to another user (never reveal which) |
| 409 | `habit_limit` | 25 habits already |
| 409 | `conflict` | Linking or merge not allowed; `detail` says why |
| 422 | `before_habit_start` / `in_future` | Day outside the habit's editable range |
| 429 | `rate_limited` | Too many auth attempts |

- Every endpoint acts only on the signed-in user. Another user's habit ID behaves exactly like a missing one (404).
- Writes that store habit data (create habit, set or clear a day, low days) need consent and return `consent_required` without it. Reads, settings, export and delete do not.

## Auth (cookies for the browser, bearer tokens for mobile)

ASP.NET Core Identity API endpoints (`MapIdentityApi<User>`) mounted at `/api/auth`:

- `POST /api/auth/register` `{ email, password }` → 200. Sends a confirmation email. Sign-in needs a confirmed email.
- `POST /api/auth/login?useCookies=true` `{ email, password }` → 200 and sets the auth cookie. Without `useCookies`, returns `{ tokenType, accessToken, expiresIn, refreshToken }` (mobile).
- `POST /api/auth/refresh` `{ refreshToken }` → new tokens (mobile).
- `GET /api/auth/confirmEmail?userId&code` → 200 (called by the web page `/confirm-email`).
- `POST /api/auth/resendConfirmationEmail` `{ email }` → 200 always.
- `POST /api/auth/forgotPassword` `{ email }` → 200 always.
- `POST /api/auth/resetPassword` `{ email, resetCode, newPassword }` → 200, or 400 `validation`.
- `POST /api/auth/logout` → 204 and clears the cookie.
- `GET /api/auth/antiforgery` → 204 and sets the `XSRF-TOKEN` cookie (readable by JS). The browser sends it back as the `X-XSRF-TOKEN` header on every POST, PUT, PATCH and DELETE (Angular `HttpClient` does this by default). Cookie-authenticated unsafe requests without it get 403 `antiforgery`. Bearer requests don't need it.

Emails link to the web app, not the API: `{WebOrigin}/confirm-email?userId=…&code=…` and `{WebOrigin}/reset-password?email=…&code=…`.

### Discord

- `GET /api/auth/discord/login?returnUrl=/today` → OAuth2 challenge (scope `identify`). On return:
  - a known Discord ID signs in its account (migrated and bot-only users included);
  - an unknown Discord ID creates a new account with that Discord login and signs it in.
  - Then redirects to `returnUrl` (local paths only, otherwise `/today`).
- `GET /api/auth/discord/link` (signed in) → OAuth2 challenge. On return it redirects to:
  - `/settings?discord=linked` when the Discord ID was free (login added) or already this account's;
  - `/link/merge` when the Discord ID belongs to a bot-only account (no email, no password); a pending merge is stored for this signed-in user for 15 minutes;
  - `/settings?discord=conflict` when it belongs to an account with a password, or this account already has a different Discord login.
- `DELETE /api/me/discord` → 204. 409 `conflict` when Discord is the only way to sign in (no password).

### Account merge

- `GET /api/account/merge` → 200 `{ habits, logs, dayMarks, habitNames: string[], kept: { timezone, graceDaysPerWeek, leaderboardOptIn } }`, or 404 when no merge is pending. `kept` is the signed-in account's settings, which win.
- `POST /api/account/merge` → 204. In one transaction: moves habits, logs and day marks to the signed-in account (both habits stay when names collide), adds the Discord login, deletes the empty bot-only account.
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
- `PATCH /api/me` `{ timezone?, graceDaysPerWeek? (0–3), leaderboardOptIn? }` → 200 `Me`. Unknown IANA zone → 400.
- `POST /api/me/consent` `{ policyVersion }` → 204. 400 when it isn't the current version.
- `POST /api/me/dm-reminders/resume` → 204.
- `GET /api/me/export?format=json|csv` → file download (same content as the bot's `/export`).
- `DELETE /api/me` `{ password? }` → 204, deletes everything, signs out. Needs the current password when the account has one (400 `validation` otherwise).

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

`state` is one of `beforestart`, `done`, `notdone`, `pending`, `lowday`, `paused` (Core `DayState`). `stats.week` is null for daily habits.

- `GET /api/habits` → `Habit[]`.
- `GET /api/habits/{id}` → `Habit`.
- `POST /api/habits` `{ name (1–100), reminderTime?, frequency, weeklyTarget? (1–6, weekly only) }` → 201 `Habit`.
- `PATCH /api/habits/{id}` `{ name?, reminderTime?, clearReminder?, frequency?, weeklyTarget? }` → 200 `Habit`.
- `DELETE /api/habits/{id}` → 204.
- `POST /api/habits/{id}/pause` `{ until: "yyyy-MM-dd" | null }` → 200 `Habit`. `null` resumes (Core `PauseHabitAsync` rules).
- `GET /api/habits/{id}/days?days=14` (1–90) → `[{ date, state, completed }]`, oldest first.
- `PUT /api/habits/{id}/days/{date}` `{ completed: bool }` → 200 `Habit`. Check-in and backfill.
- `DELETE /api/habits/{id}/days/{date}` → 200 `Habit`. Clears the day.
- `GET /api/habit-templates` → `[{ key, name, emoji?, frequency, weeklyTarget? }]` (Core `HabitTemplates`).

## Low days and stats

- `GET /api/low-days` → `string[]` of dates.
- `PUT /api/low-days/{date}` → 204. `DELETE /api/low-days/{date}` → 204.
- `GET /api/stats/weekly` → `{ totalDone, totalPossible, headline, footer, habits: [{ habitId, name, done, possible, streak }] }` for the 7 days ending yesterday (Core `WeeklySummaryService`).

## Web push (Phase 6 server slice, shape fixed now)

- `GET /api/push/vapid-public-key` → `{ key }`.
- `POST /api/me/push-subscriptions` `{ endpoint, keys: { p256dh, auth } }` → 204. `DELETE /api/me/push-subscriptions` `{ endpoint }` → 204.
- `Habit.reminderChannels`: `("discord" | "webpush")[]`, settable via `PATCH /api/habits/{id}`. The default is the channel the habit was created from.
- Until the server slice lands these return 501 and `reminderChannels` is absent; the web app hides push settings on 501.

## Health

- `GET /health` → 200 when the API and database are reachable.
