# Ember.Api.TestHost

Runs the real Ember API for local and end-to-end testing. Needs Docker; never part of `src/` or the Docker image.

```
dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:5081
```

- Starts a throwaway `postgres:17-alpine` container, applies the migrations and removes the container on shutdown (Ctrl+C).
- Runs in the Development environment.
- `Ember__WebOrigin` defaults to the first `--urls` value. Behind the Angular dev proxy, set it to the dev server: `Ember__WebOrigin=http://localhost:4200`. Email links and the Discord redirect URI use it.
- Emails go to an in-memory outbox; Discord is faked at the backchannel (the real OAuth handler runs).

## Test endpoints

| Request | Response |
| --- | --- |
| `GET /test/discord/next?id=<discordId>` | 204. The next Discord authorization returns this Discord user ID (used once). Without it the callback fails like a Discord error. |
| `GET /test/discord/next?error=access_denied` | 204. The next authorization ends as if the user cancelled on Discord. |
| `GET /test/outbox?email=<address>` | 200 `{ "to", "subject", "links": ["http://…"] }` of the latest email to that address, 404 when none. |
| `POST /test/users/bot-only` `{ "discordId": "<id>", "habitStartDate": "yyyy-MM-dd" }` | 201 `{ "userId", "habitId" }`: a bot-only user (no email, no password, UTC timezone) with consent and one habit "Water" without reminder. `habitStartDate` is optional (default today) and backdates the habit's creation to noon UTC that day so past days can be backfilled; an invalid or future date → 400. 409 when the Discord ID is already taken. |

`GET /test/discord/authorize` is the fake Discord consent page: the API's challenge sends the browser there and it redirects straight to the callback.

Unsafe requests sent with a signed-in session cookie need the `X-XSRF-TOKEN` header, including `POST /test/users/bot-only`.

## Discord journey

1. `GET /test/discord/next?id=123456789012345678`
2. Navigate to `/api/auth/discord/login?returnUrl=/today` (or `/api/auth/discord/link` while signed in).
3. The browser passes `/test/discord/authorize` and `/api/auth/discord/callback` and lands on `returnUrl` (login) or `/settings?discord=linked`, `/settings?discord=conflict` or `/link/merge` (link). Errors land on `/login?discord=error` or `/settings?discord=error`.
