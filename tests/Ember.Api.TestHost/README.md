# Ember.Api.TestHost

Runs the real Ember API for local and end-to-end testing. Needs Docker; never part of `src/` or the Docker image.

```
dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:5081
```

- Starts a throwaway `postgres:17-alpine` container, applies the migrations and removes the container on shutdown (Ctrl+C).
- Runs in the Development environment.
- `Ember__WebOrigin` defaults to the first `--urls` value. Behind the web dev server proxy, set it to the dev server: `Ember__WebOrigin=http://localhost:4200`. Email links and the Discord redirect URI use it.
- Emails go to an in-memory outbox; Discord is faked at the backchannel (the real OAuth handler runs).
- Email confirmation: the link from the outbox opens `{WebOrigin}/confirm-email?userId=…&code=…`; the page then sends `POST /api/auth/confirmEmail` `{ userId, code, password }` with the password chosen at sign-up. `GET /api/auth/confirmEmail` is 404.

## Same-origin web app (Playwright)

Serve a built web app from the test host, so the app and the API share one origin:

```
dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:5081 --webroot web/dist/ember-web/browser
```

A relative `--webroot` path resolves against the repo root (the folder with `Ember.slnx`), so the command works from any directory; `Ember__WebRoot` instead takes a path relative to the current directory. Email links point to `http://localhost:5081/confirm-email`, `/reset-password` etc., which the SPA fallback serves.

## Test endpoints

| Request | Response |
| --- | --- |
| `GET /test/discord/next?id=<discordId>` | 204. The next Discord authorization returns this Discord user ID (used once). Without it the callback fails like a Discord error. |
| `GET /test/discord/next?error=access_denied` | 204. The next authorization ends as if the user cancelled on Discord. |
| `GET /test/outbox?email=<address>` | 200 `{ "to", "subject", "links": ["http://…"] }` of the latest email to that address, 404 when none. Mail is sent in the background, so poll briefly after the request that sends it. |
| `GET /test/users/totp?email=<address>` | 200 `{ "code" }`: the current 6-digit TOTP for that account's authenticator key (after `POST /api/me/2fa/setup`), for completing 2FA setup and sign-in. 404 when the account or key doesn't exist. Codes change every 30 seconds. |
| `GET /test/reminders/targets?habitId=<id>` or `?routineId=<id>` | 200 `{ "discord": bool, "pushSubscriptionIds": [int] }`: where the bot would send that habit's or routine's reminder right now (the same resolver as dispatch: Discord when linked, answered yes, DMs not paused and not excluded; each enabled push subscription not excluded). Needs a signed-in session; a habit or routine of another account, or an unknown id, → 404. Pass exactly one of the two ids, else 400. |
| `POST /test/users/bot-only` `{ "discordId": "<id>", "habitStartDate": "yyyy-MM-dd" }` | 201 `{ "userId", "habitId" }`: a bot-only user (no email, no password, UTC timezone) with consent and one habit "Water" without reminder. `habitStartDate` is optional (default today) and backdates the habit's creation to noon UTC that day so past days can be backfilled; an invalid or future date → 400. 409 when the Discord ID is already taken. |

`GET /test/discord/authorize` is the fake Discord consent page: the API's challenge sends the browser there and it redirects straight to the callback.

Unsafe requests sent with a signed-in session cookie need the `X-XSRF-TOKEN` header, including `POST /test/users/bot-only`.

## Discord journey

1. `GET /test/discord/next?id=123456789012345678`
2. Navigate to `/api/auth/discord/login?returnUrl=/today` (or `/api/auth/discord/link` while signed in).
3. The browser passes `/test/discord/authorize` and `/api/auth/discord/callback` and lands on `returnUrl` (login) or `/settings?discord=linked`, `/settings?discord=conflict` or `/link/merge` (link). Errors land on `/login?discord=error` or `/settings?discord=error`.
