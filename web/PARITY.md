# React port parity

## 1. Unit tests

Counted by reading the 16 files under `web/src/app/**/*.spec.ts`: **113** `it`/`it.each` declarations, **132** cases with every `it.each` row expanded. The brief's figure of 124 matches neither count, so the table lists all 132 expanded cases.

| File | Declarations | Expanded cases | Owner |
| --- | --- | --- | --- |
| core/local-date.spec.ts | 10 | 11 | S1 |
| core/problem.spec.ts | 16 | 16 | S1 |
| core/return-url.spec.ts | 3 | 12 | S1 |
| features/history/calendar.spec.ts | 14 | 14 | S1 |
| core/native/reminder-plan.spec.ts | 12 | 12 | S1 |
| core/api-client.offline.spec.ts | 4 | 5 | S2 |
| core/api-base.interceptor.spec.ts | 3 | 3 | S2 |
| core/auth.service.spec.ts | 6 | 7 | S2 |
| core/error.interceptor.spec.ts | 8 | 8 | S2 |
| core/offline-queue.spec.ts | 10 | 15 | S2 |
| core/push.service.spec.ts | 10 | 10 | S2 |
| core/native/bearer.interceptor.spec.ts | 8 | 9 | S2 |
| core/native/token-store.spec.ts | 6 | 6 | S2 |
| features/today/today.spec.ts | 1 | 1 | S3 |
| features/habits/habit-edit.spec.ts | 1 | 2 | S3 |
| features/settings/settings.spec.ts | 1 | 1 | S4 |
| **Total** | **113** | **132** | |

Original paths are relative to `web/src/app/`; React paths to `web/src/`.

| Original (file › name) | React test (file › name) | Status |
| --- | --- | --- |
| core/local-date.spec.ts › local-date › monthWeeks › starts on Monday, has rows of 7 and covers every day of the month | lib/local-date.test.ts › local-date › monthWeeks › starts on Monday, has rows of 7 and covers every day of the month | ported |
| core/local-date.spec.ts › local-date › monthWeeks › does not add a leading row when the month begins on a Monday | lib/local-date.test.ts › local-date › monthWeeks › does not add a leading row when the month begins on a Monday | ported |
| core/local-date.spec.ts › local-date › monthWeeks › adds a sixth row when a 31-day month starts late in the week | lib/local-date.test.ts › local-date › monthWeeks › adds a sixth row when a 31-day month starts late in the week | ported |
| core/local-date.spec.ts › local-date › addDays › crosses month and year ends in both directions | lib/local-date.test.ts › local-date › addDays › crosses month and year ends in both directions | ported |
| core/local-date.spec.ts › local-date › addDays › moves exactly one day over the DST change 2026-03-28 | lib/local-date.test.ts › local-date › addDays › moves exactly one day over the DST change 2026-03-28 | ported |
| core/local-date.spec.ts › local-date › addDays › moves exactly one day over the DST change 2026-10-24 | lib/local-date.test.ts › local-date › addDays › moves exactly one day over the DST change 2026-10-24 | ported |
| core/local-date.spec.ts › local-date › daysBetween › counts whole days, signed, across DST changes and year ends | lib/local-date.test.ts › local-date › daysBetween › counts whole days, signed, across DST changes and year ends | ported |
| core/local-date.spec.ts › local-date › addMonths lands on the first of the target month across years | lib/local-date.test.ts › local-date › addMonths lands on the first of the target month across years | ported |
| core/local-date.spec.ts › local-date › isLocalDate rejects impossible calendar days | lib/local-date.test.ts › local-date › isLocalDate rejects impossible calendar days | ported |
| core/local-date.spec.ts › local-date › time zones › labels a zone with its name and a UTC offset | lib/local-date.test.ts › local-date › time zones › labels a zone with its name and a UTC offset | ported |
| core/local-date.spec.ts › local-date › time zones › accepts real zones and rejects garbage | lib/local-date.test.ts › local-date › time zones › accepts real zones and rejects garbage | ported |
| core/problem.spec.ts › problemToMessage › 401 › treats login failures as form messages, different from a general session end | lib/problem.test.ts › problemToMessage › 401 › treats login failures as form messages, different from a general session end | ported |
| core/problem.spec.ts › problemToMessage › 401 › offers to resend the confirmation link only for an unconfirmed login | lib/problem.test.ts › problemToMessage › 401 › offers to resend the confirmation link only for an unconfirmed login | ported |
| core/problem.spec.ts › problemToMessage › 401 › reads a failed confirmation as a form error with a resend, and a bad reset link without one, never as a session end | lib/problem.test.ts › problemToMessage › 401 › reads a failed confirmation as a form error with a resend, and a bad reset link without one, never as a session end | ported |
| core/problem.spec.ts › problemToMessage › 400 › maps Identity codes to the password and email fields | lib/problem.test.ts › problemToMessage › 400 › maps Identity codes to the password and email fields | ported |
| core/problem.spec.ts › problemToMessage › 400 › maps an unknown Password* code to the password field using the server message | lib/problem.test.ts › problemToMessage › 400 › maps an unknown Password* code to the password field using the server message | ported |
| core/problem.spec.ts › problemToMessage › 400 › turns InvalidToken into an expired-link message without a field | lib/problem.test.ts › problemToMessage › 400 › turns InvalidToken into an expired-link message without a field | ported |
| core/problem.spec.ts › problemToMessage › 400 › maps contract validation field names to camelCase fields with the server messages | lib/problem.test.ts › problemToMessage › 400 › maps contract validation field names to camelCase fields with the server messages | ported |
| core/problem.spec.ts › problemToMessage › 400 › falls back to the detail when there are no field errors | lib/problem.test.ts › problemToMessage › 400 › falls back to the detail when there are no field errors | ported |
| core/problem.spec.ts › problemToMessage › puts the Retry-After seconds into the 429 message | lib/problem.test.ts › problemToMessage › puts the Retry-After seconds into the 429 message | ported |
| core/problem.spec.ts › problemToMessage › switches 429 to minutes for long waits and stays generic without a header | lib/problem.test.ts › problemToMessage › switches 429 to minutes for long waits and stays generic without a header | ported |
| core/problem.spec.ts › problemToMessage › surfaces the detail of a 409 conflict and a distinct message for habit_limit | lib/problem.test.ts › problemToMessage › surfaces the detail of a 409 conflict and a distinct message for habit_limit | ported |
| core/problem.spec.ts › problemToMessage › gives 422 in_future, before_habit_start and other reasons different messages | lib/problem.test.ts › problemToMessage › gives 422 in_future, before_habit_start and other reasons different messages | ported |
| core/problem.spec.ts › problemToMessage › distinguishes consent_required and antiforgery on 403 | lib/problem.test.ts › problemToMessage › distinguishes consent_required and antiforgery on 403 | ported |
| core/problem.spec.ts › problemToMessage › describes a network failure and a server failure differently | lib/problem.test.ts › problemToMessage › describes a network failure and a server failure differently | ported |
| core/problem.spec.ts › toApiError › carries status, problem body and Retry-After seconds | lib/problem.test.ts › toApiError › carries status, problem body and Retry-After seconds | ported (adapted to `toApiError(status, body, headers)`) |
| core/problem.spec.ts › toApiError › ignores a non-object body and a missing Retry-After | lib/problem.test.ts › toApiError › ignores a non-object body and a missing Retry-After | ported (adapted to `toApiError(status, body, headers)`) |
| core/return-url.spec.ts › safeReturnUrl › keeps the local path /today | lib/return-url.test.ts › safeReturnUrl › keeps the local path /today | ported |
| core/return-url.spec.ts › safeReturnUrl › keeps the local path /history?x=1 | lib/return-url.test.ts › safeReturnUrl › keeps the local path /history?x=1 | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for //evil.com | lib/return-url.test.ts › safeReturnUrl › falls back for //evil.com | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for /\evil.com | lib/return-url.test.ts › safeReturnUrl › falls back for /\evil.com | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for /(tab)/evil.com | lib/return-url.test.ts › safeReturnUrl › falls back for /(tab)/evil.com | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for /(newline)/evil.com | lib/return-url.test.ts › safeReturnUrl › falls back for /(newline)/evil.com | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for https://evil.com | lib/return-url.test.ts › safeReturnUrl › falls back for https://evil.com | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for today | lib/return-url.test.ts › safeReturnUrl › falls back for today | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for '' (empty) | lib/return-url.test.ts › safeReturnUrl › falls back for '' (empty) | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for null | lib/return-url.test.ts › safeReturnUrl › falls back for null | ported |
| core/return-url.spec.ts › safeReturnUrl › falls back for undefined | lib/return-url.test.ts › safeReturnUrl › falls back for undefined | ported |
| core/return-url.spec.ts › safeReturnUrl › uses the given fallback | lib/return-url.test.ts › safeReturnUrl › uses the given fallback | ported |
| features/history/calendar.spec.ts › buildMonth › lays out full Monday-start weeks of seven days | lib/calendar.test.ts › buildMonth › lays out full Monday-start weeks of seven days | ported |
| features/history/calendar.spec.ts › buildMonth › marks padding cells outside the month and never makes them editable | lib/calendar.test.ts › buildMonth › marks padding cells outside the month and never makes them editable | ported |
| features/history/calendar.spec.ts › buildMonth › resolves each cell to the right state | lib/calendar.test.ts › buildMonth › resolves each cell to the right state | ported |
| features/history/calendar.spec.ts › buildMonth › lets the server state win over the low day list while still flagging the low day | lib/calendar.test.ts › buildMonth › lets the server state win over the low day list while still flagging the low day | ported |
| features/history/calendar.spec.ts › buildMonth › allows edits only from the start date through today inside the month | lib/calendar.test.ts › buildMonth › allows edits only from the start date through today inside the month | ported |
| features/history/calendar.spec.ts › buildMonth › flags only today | lib/calendar.test.ts › buildMonth › flags only today | ported |
| features/history/calendar.spec.ts › monthRange › covers the whole month for a past month after the start | lib/calendar.test.ts › monthRange › covers the whole month for a past month after the start | ported |
| features/history/calendar.spec.ts › monthRange › clamps to the start date and to today | lib/calendar.test.ts › monthRange › clamps to the start date and to today | ported |
| features/history/calendar.spec.ts › monthRange › is null when the month has no days between start and today | lib/calendar.test.ts › monthRange › is null when the month has no days between start and today | ported |
| features/history/calendar.spec.ts › month paging › stops going back at the habit start month | lib/calendar.test.ts › month paging › stops going back at the habit start month | ported |
| features/history/calendar.spec.ts › month paging › stops going forward at the current month | lib/calendar.test.ts › month paging › stops going forward at the current month | ported |
| features/history/calendar.spec.ts › dayLabel › never says "missed" for any state | lib/calendar.test.ts › dayLabel › never says "missed" for any state | ported |
| features/history/calendar.spec.ts › dayLabel › gives every state and a future day a distinct non-empty label | lib/calendar.test.ts › dayLabel › gives every state and a future day a distinct non-empty label | ported |
| features/history/calendar.spec.ts › dayLabel › prefixes today for a checked-in day | lib/calendar.test.ts › dayLabel › prefixes today for a checked-in day | ported |
| core/native/reminder-plan.spec.ts › planReminders › schedules only habits with the mobile channel and a reminder time | lib/native/reminder-plan.test.ts › planReminders › schedules only habits with the mobile channel and a reminder time | ported |
| core/native/reminder-plan.spec.ts › planReminders › plans seven local days starting today at the reminder time in the account zone | lib/native/reminder-plan.test.ts › planReminders › plans seven local days starting today at the reminder time in the account zone | ported |
| core/native/reminder-plan.spec.ts › planReminders › follows the account time zone for the day boundary, not the process zone | lib/native/reminder-plan.test.ts › planReminders › follows the account time zone for the day boundary, not the process zone | ported |
| core/native/reminder-plan.spec.ts › planReminders › skips instants that are already past | lib/native/reminder-plan.test.ts › planReminders › skips instants that are already past | ported |
| core/native/reminder-plan.spec.ts › planReminders › skips days before the habit started | lib/native/reminder-plan.test.ts › planReminders › skips days before the habit started | ported |
| core/native/reminder-plan.spec.ts › planReminders › skips days inside the pause window, bounds included | lib/native/reminder-plan.test.ts › planReminders › skips days inside the pause window, bounds included | ported |
| core/native/reminder-plan.spec.ts › planReminders › skips today when it is already done but keeps tomorrow | lib/native/reminder-plan.test.ts › planReminders › skips today when it is already done but keeps tomorrow | ported |
| core/native/reminder-plan.spec.ts › planReminders › keeps the local reminder time on both sides of a DST change | lib/native/reminder-plan.test.ts › planReminders › keeps the local reminder time on both sides of a DST change | ported |
| core/native/reminder-plan.spec.ts › planReminders › sorts soonest first, numbers ids from 1 and keeps the soonest 60 | lib/native/reminder-plan.test.ts › planReminders › sorts soonest first, numbers ids from 1 and keeps the soonest 60 | ported |
| core/native/reminder-plan.spec.ts › zonedToUtc › moves a time inside the spring-forward gap to the first valid time after it | lib/native/reminder-plan.test.ts › zonedToUtc › moves a time inside the spring-forward gap to the first valid time after it | ported |
| core/native/reminder-plan.spec.ts › zonedToUtc › uses the first occurrence of an ambiguous fall-back time | lib/native/reminder-plan.test.ts › zonedToUtc › uses the first occurrence of an ambiguous fall-back time | ported |
| core/native/reminder-plan.spec.ts › zonedToUtc › converts an ordinary local time with the zone offset of that day | lib/native/reminder-plan.test.ts › zonedToUtc › converts an ordinary local time with the zone offset of that day | ported |
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after getHabit | | pending S2 |
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after listHabits | | pending S2 |
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a clear lost to the network as a pending day and queues it | | pending S2 |
| core/api-client.offline.spec.ts › ApiClient offline day edits › rejects a server error and queues nothing | | pending S2 |
| core/api-client.offline.spec.ts › ApiClient offline day edits › rejects a network failure for a habit it never saw and queues nothing | | pending S2 |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › sends /api calls to the configured origin in the native build | | pending S2 |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › leaves non-API paths relative | | pending S2 |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › keeps /api calls relative when the base is empty (web build) | | pending S2 |
| core/auth.service.spec.ts › AuthService › login › with staySignedIn=false posts to /api/auth/login?useSessionCookies=true, then refreshes antiforgery, then loads me | | pending S2 |
| core/auth.service.spec.ts › AuthService › login › with staySignedIn=true posts to /api/auth/login?useCookies=true, then refreshes antiforgery, then loads me | | pending S2 |
| core/auth.service.spec.ts › AuthService › login › still loads me when the antiforgery refresh fails | | pending S2 |
| core/auth.service.spec.ts › AuthService › logout › removes the push subscription before signing out, then refreshes antiforgery and clears the session | | pending S2 |
| core/auth.service.spec.ts › AuthService › logout › signs out without touching push endpoints when there is no subscription | | pending S2 |
| core/auth.service.spec.ts › AuthService › logout › wipes the user's queued edits and remembered phone channels from the device | | pending S2 |
| core/auth.service.spec.ts › AuthService › logout › still signs out locally when the server call fails | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › refreshes the antiforgery token once and retries the POST with the new token, whose success reaches the caller | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › does not retry a second antiforgery failure and rejects with an ApiError | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › rejects with the original error when the token refresh itself fails | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › leaves a failed login alone: the session stays and nothing navigates | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › ends the session and routes to /login with returnUrl on a 401 while signed in | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › does not redirect a 401 when nobody is signed in | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › routes to /consent on consent_required and marks the error handled | | pending S2 |
| core/error.interceptor.spec.ts › errorInterceptor › passes other failures through as unhandled ApiErrors | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › sends an edit queued while a replay is running in that same replay | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › refuses to queue without a signed-in user | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › counts the signed-in user’s queued edits as pending | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › replays in insertion order, drops sent edits from the queue and sends nothing the second time | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › sends the same edit twice when it was queued twice | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › drops edits refused with 404 or 422 before_habit_start / in_future and continues | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 403 consent_required | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 401 | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 429 | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 500 | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on network failure | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 422 with another type | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › never replays one user’s edits for another user | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › clearing one user leaves the other user’s queue | | pending S2 |
| core/offline-queue.spec.ts › OfflineQueue › resets pending when the signed-in user is cleared | | pending S2 |
| core/push.service.spec.ts › PushService › stays unavailable when the server answers 501 | | pending S2 |
| core/push.service.spec.ts › PushService › becomes available once the server returns a key | | pending S2 |
| core/push.service.spec.ts › PushService › registers the browser subscription with endpoint and keys | | pending S2 |
| core/push.service.spec.ts › PushService › rolls back the browser subscription when the server rejects it | | pending S2 |
| core/push.service.spec.ts › PushService › claim re-registers the existing browser subscription once | | pending S2 |
| core/push.service.spec.ts › PushService › claim makes no call without a browser subscription | | pending S2 |
| core/push.service.spec.ts › PushService › claim makes no call and does not throw when the server offers no push | | pending S2 |
| core/push.service.spec.ts › PushService › claim does not throw when the server rejects the registration | | pending S2 |
| core/push.service.spec.ts › PushService › removes the server subscription by endpoint before unsubscribing the browser | | pending S2 |
| core/push.service.spec.ts › PushService › keeps the browser subscription when the server removal fails | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › posts the login without cookie flags and keeps the refresh token in secure storage only | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › attaches the bearer token to /api calls after sign-in | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › never sends the token to another origin | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › keeps the refresh token out of secure storage when persist is off, yet still refreshes it | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › refreshes once for two concurrent 401s and retries both with the new token | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › clears the stored token when the refresh fails and passes the original 401 on | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › passes the refresh error (503) on and keeps the stored token when the refresh fails transiently | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › passes the refresh error (429) on and keeps the stored token when the refresh fails transiently | | pending S2 |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › never refreshes a 401 from the login endpoint | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › resolves false without a request when there is no refresh token | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › restores a session from the persisted refresh token after a restart | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › keeps the stored refresh token when the refresh fails with a server error | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › forgets the stored refresh token when the server refuses it | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › discards a refresh that completes after clear, so logout stays signed out | | pending S2 |
| core/native/token-store.spec.ts › TokenStore › forgets both tokens on clear | | pending S2 |
| features/today/today.spec.ts › TodayPage › looks up low days for the local day reloaded from the server, not the stale cached one | | pending S3 |
| features/habits/habit-edit.spec.ts › HabitEditPage reminder channels › drops mobile when Discord DM is added to a mobile-only habit | | pending S3 |
| features/habits/habit-edit.spec.ts › HabitEditPage reminder channels › drops mobile when Web push is added to a mobile-only habit | | pending S3 |
| features/settings/settings.spec.ts › SettingsPage › sends quick successive grace changes one PATCH at a time, in order | | pending S4 |

New React tests without an Angular original:

- `lib/problem.test.ts › asApiError › passes an ApiError through and reads a fetch network failure as status 0` (the fetch `TypeError` path that replaces `HttpErrorResponse` status 0).
- `lib/store.test.ts › Store › notifies only on a real change and stops after unsubscribe` (the `Store` contract that replaces Angular signals).

No original test was dropped or merged in S1.

## 2. E2E

The brief names 7 tests; `web/e2e/*.spec.ts` currently holds 9 across 7 files.

| Test (file › name) | Status |
| --- | --- |
| backfill-last-week.spec.ts › last week is backfilled in History and survives a reload | pending S3/S4 |
| csp-pages.spec.ts › the built index.html has no inline scripts, event handlers or style attributes | pending S3/S4 |
| csp-pages.spec.ts › Today, History and Settings load without CSP violations | pending S3/S4 |
| delete-account.spec.ts › deleting the account signs out and the credentials stop working | pending S3/S4 |
| link-discord-merge.spec.ts › linking a bot-only Discord account merges its habit into the web account | pending S3/S4 |
| link-discord-merge.spec.ts › linking a Discord account nobody has used goes straight to linked | pending S3/S4 |
| offline-checkin.spec.ts › a check-in made offline syncs once the browser is back online | pending S3/S4 |
| signup-first-habit.spec.ts › a new user signs up, confirms, creates a first habit and checks in | pending S3/S4 |
| styles-csp.spec.ts › the production build applies its full stylesheet under the API CSP without violations | pending S3/S4 |

## 3. Review fixes

Filled in S2.

## 4. Frozen strings

URL assertions are end-anchored (`/today$`, `/login$`, `/login?reason=deleted$`, `/link/merge$`): those navigations add no extra query string or hash.

Pinned by `web/e2e/**` (plan amendment F8). Changing any of these needs a spec selector edit, never an expectation edit. Roles and accessible names are exact unless marked as a pattern.

| Screen | Route | Role / selector | Name or text |
| --- | --- | --- | --- |
| Sign up | `/signup` | label | `Email`, `Password` (exact) |
| Sign up | | button | `Create account` |
| Sign up | | heading (after submit) | `Check your inbox` |
| Confirm email | emailed link | label | `Password` (exact) |
| Confirm email | | button | `Confirm email` |
| Confirm email | | heading (success) | `You're confirmed` |
| Login | `/login` | label | `Email`, `Password` (exact) |
| Login | | button | `Sign in` (exact) |
| Login | | link | `Sign in with Discord` |
| Login | | `role=alert` on wrong credentials | text matching `/match/i`; URL stays `/login`; no text matching `/session ended/i` |
| Login | `/login?reason=deleted` | `role=status` | text matching `/deleted/i` |
| Consent | `/consent` | heading | `One quick question` |
| Consent | | button | `I agree` → URL `/today` |
| Today | `/today` | heading | `Today` (exact) |
| Today | | link (no habits) | `Create your first habit` |
| Today | | heading per habit | the habit name (exact) |
| Today | | button per habit | `Check in <name> for today`, with `aria-pressed` `true`/`false` |
| Today | | text | `/\d+-day streak/` |
| Today | | text while an edit is queued offline | `/saved on this device/`, hidden again after the sync |
| Habit new | `/habits/new` | button | `Start from scratch` |
| Habit new | | label | `Name` (exact) |
| Habit new | | button | `Create habit` → URL `/today` |
| History | `/history` | heading | `History` (exact) |
| History | | buttons | `Previous month`, `Next month` |
| History | | day buttons | `button` with `id="day-yyyy-MM-dd"`, attributes `data-state` (`done`, `notdone`, `lowday`, …) and `aria-expanded` |
| History | | structure | Only in-month, editable days (habit start through today) are `button#day-…`; padding, future and before-start cells are not buttons and carry no `day-` id, because `showMonthOf` reads the month from the first `button[id^="day-"]`. `aria-expanded` is always the string `true` or `false`. `#day-panel` contains no `day-` ids |
| History | | day panel | `#day-panel` with buttons `Done`, `Not done`, `Mark as a low day` (exact) |
| Settings | `/settings` | link | `Link Discord` |
| Settings | | button | `Unlink Discord` |
| Settings | | `role=status` | text matching `/Discord is linked/` |
| Settings | | label | `Your password` (exact), `Type DELETE to confirm` |
| Settings | | button | `Delete my account` → URL `/login?reason=deleted` |
| Merge | `/link/merge` | heading | `Bring your Discord habits over` |
| Merge | | list | named `Habits to move`, one `listitem` per habit (text = habit name) |
| Merge | | text | `/Your settings stay as they are/` |
| Merge | | button | `Move everything here` → URL `/settings` |
| Any (CSP) | `/login` | `head link[rel=stylesheet]` | `media` absent or `all`; zero CSP violations |
