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
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after getHabit | lib/api-client.test.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after getHabit | ported |
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after listHabits | lib/api-client.test.ts › ApiClient offline day edits › answers a check-in lost to the network optimistically and queues it after listHabits | ported |
| core/api-client.offline.spec.ts › ApiClient offline day edits › answers a clear lost to the network as a pending day and queues it | lib/api-client.test.ts › ApiClient offline day edits › answers a clear lost to the network as a pending day and queues it | ported |
| core/api-client.offline.spec.ts › ApiClient offline day edits › rejects a server error and queues nothing | lib/api-client.test.ts › ApiClient offline day edits › rejects a server error and queues nothing | ported |
| core/api-client.offline.spec.ts › ApiClient offline day edits › rejects a network failure for a habit it never saw and queues nothing | lib/api-client.test.ts › ApiClient offline day edits › rejects a network failure for a habit it never saw and queues nothing | ported |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › sends /api calls to the configured origin in the native build | lib/http.test.ts › Http URLs › sends /api calls to the configured origin in the native build | ported |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › leaves non-API paths relative | lib/http.test.ts › Http URLs › leaves non-API paths relative | ported |
| core/api-base.interceptor.spec.ts › apiBaseInterceptor › keeps /api calls relative when the base is empty (web build) | lib/http.test.ts › Http URLs › keeps /api calls relative when the base is empty (web build) | ported |
| core/auth.service.spec.ts › AuthService › login › with staySignedIn=false posts to /api/auth/login?useSessionCookies=true, then refreshes antiforgery, then loads me | lib/auth.test.ts › AuthService › login › with staySignedIn=false posts to /api/auth/login?useSessionCookies=true, then refreshes antiforgery, then loads me | ported |
| core/auth.service.spec.ts › AuthService › login › with staySignedIn=true posts to /api/auth/login?useCookies=true, then refreshes antiforgery, then loads me | lib/auth.test.ts › AuthService › login › with staySignedIn=true posts to /api/auth/login?useCookies=true, then refreshes antiforgery, then loads me | ported |
| core/auth.service.spec.ts › AuthService › login › still loads me when the antiforgery refresh fails | lib/auth.test.ts › AuthService › login › still loads me when the antiforgery refresh fails | ported |
| core/auth.service.spec.ts › AuthService › logout › removes the push subscription before signing out, then refreshes antiforgery and clears the session | lib/auth.test.ts › AuthService › logout › removes the push subscription before signing out, then refreshes antiforgery and clears the session | ported (the fake `PushManager` subscription replaces the `SwPush` stub) |
| core/auth.service.spec.ts › AuthService › logout › signs out without touching push endpoints when there is no subscription | lib/auth.test.ts › AuthService › logout › signs out without touching push endpoints when there is no subscription | ported |
| core/auth.service.spec.ts › AuthService › logout › wipes the user's queued edits and remembered phone channels from the device | lib/auth.test.ts › AuthService › logout › wipes the user's queued edits and remembered phone channels from the device | ported |
| core/auth.service.spec.ts › AuthService › logout › still signs out locally when the server call fails | lib/auth.test.ts › AuthService › logout › still signs out locally when the server call fails | ported |
| core/error.interceptor.spec.ts › errorInterceptor › refreshes the antiforgery token once and retries the POST with the new token, whose success reaches the caller | lib/http.test.ts › Http errors › refreshes the antiforgery token once and retries the POST with the new token, whose success reaches the caller | ported |
| core/error.interceptor.spec.ts › errorInterceptor › does not retry a second antiforgery failure and rejects with an ApiError | lib/http.test.ts › Http errors › does not retry a second antiforgery failure and rejects with an ApiError | ported |
| core/error.interceptor.spec.ts › errorInterceptor › rejects with the original error when the token refresh itself fails | lib/http.test.ts › Http errors › rejects with the original error when the token refresh itself fails | ported |
| core/error.interceptor.spec.ts › errorInterceptor › leaves a failed login alone: the session stays and nothing navigates | lib/http.test.ts › Http errors › leaves a failed login alone: the session stays and nothing navigates | ported |
| core/error.interceptor.spec.ts › errorInterceptor › ends the session and routes to /login with returnUrl on a 401 while signed in | lib/http.test.ts › Http errors › ends the session and routes to /login with returnUrl on a 401 while signed in | ported (now asserts the exact `returnUrl` and `reason=session`) |
| core/error.interceptor.spec.ts › errorInterceptor › does not redirect a 401 when nobody is signed in | lib/http.test.ts › Http errors › does not redirect a 401 when nobody is signed in | ported |
| core/error.interceptor.spec.ts › errorInterceptor › routes to /consent on consent_required and marks the error handled | lib/http.test.ts › Http errors › routes to /consent on consent_required and marks the error handled | ported |
| core/error.interceptor.spec.ts › errorInterceptor › passes other failures through as unhandled ApiErrors | lib/http.test.ts › Http errors › passes other failures through as unhandled ApiErrors | ported |
| core/offline-queue.spec.ts › OfflineQueue › sends an edit queued while a replay is running in that same replay | lib/offline-queue.test.ts › OfflineQueue › sends an edit queued while a replay is running in that same replay | ported |
| core/offline-queue.spec.ts › OfflineQueue › refuses to queue without a signed-in user | lib/offline-queue.test.ts › OfflineQueue › refuses to queue without a signed-in user | ported |
| core/offline-queue.spec.ts › OfflineQueue › counts the signed-in user’s queued edits as pending | lib/offline-queue.test.ts › OfflineQueue › counts the signed-in user’s queued edits as pending | ported |
| core/offline-queue.spec.ts › OfflineQueue › replays in insertion order, drops sent edits from the queue and sends nothing the second time | lib/offline-queue.test.ts › OfflineQueue › replays in insertion order, drops sent edits from the queue and sends nothing the second time | ported |
| core/offline-queue.spec.ts › OfflineQueue › sends the same edit twice when it was queued twice | lib/offline-queue.test.ts › OfflineQueue › sends the same edit twice when it was queued twice | ported |
| core/offline-queue.spec.ts › OfflineQueue › drops edits refused with 404 or 422 before_habit_start / in_future and continues | lib/offline-queue.test.ts › OfflineQueue › drops edits refused with 404 or 422 before_habit_start / in_future and continues | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 403 consent_required | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on 403 consent_required | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 401 | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on 401 | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 429 | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on 429 | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 500 | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on 500 | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on network failure | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on network failure | ported |
| core/offline-queue.spec.ts › OfflineQueue › keeps the edit and stops the replay on 422 with another type | lib/offline-queue.test.ts › OfflineQueue › keeps the edit and stops the replay on 422 with another type | ported |
| core/offline-queue.spec.ts › OfflineQueue › never replays one user’s edits for another user | lib/offline-queue.test.ts › OfflineQueue › never replays one user’s edits for another user | ported |
| core/offline-queue.spec.ts › OfflineQueue › clearing one user leaves the other user’s queue | lib/offline-queue.test.ts › OfflineQueue › clearing one user leaves the other user’s queue | ported |
| core/offline-queue.spec.ts › OfflineQueue › resets pending when the signed-in user is cleared | lib/offline-queue.test.ts › OfflineQueue › resets pending when the signed-in user is cleared | ported |
| core/push.service.spec.ts › PushService › stays unavailable when the server answers 501 | lib/push.test.ts › PushService › stays unavailable when the server answers 501 | ported |
| core/push.service.spec.ts › PushService › becomes available once the server returns a key | lib/push.test.ts › PushService › becomes available once the server returns a key | ported |
| core/push.service.spec.ts › PushService › registers the browser subscription with endpoint and keys | lib/push.test.ts › PushService › registers the browser subscription with endpoint and keys | ported (asserts `PushManager.subscribe` with `userVisibleOnly` and the decoded key bytes) |
| core/push.service.spec.ts › PushService › rolls back the browser subscription when the server rejects it | lib/push.test.ts › PushService › rolls back the browser subscription when the server rejects it | ported |
| core/push.service.spec.ts › PushService › claim re-registers the existing browser subscription once | lib/push.test.ts › PushService › claim re-registers the existing browser subscription once | ported |
| core/push.service.spec.ts › PushService › claim makes no call without a browser subscription | lib/push.test.ts › PushService › claim makes no call without a browser subscription | ported |
| core/push.service.spec.ts › PushService › claim makes no call and does not throw when the server offers no push | lib/push.test.ts › PushService › claim makes no call and does not throw when the server offers no push | ported |
| core/push.service.spec.ts › PushService › claim does not throw when the server rejects the registration | lib/push.test.ts › PushService › claim does not throw when the server rejects the registration | ported |
| core/push.service.spec.ts › PushService › removes the server subscription by endpoint before unsubscribing the browser | lib/push.test.ts › PushService › removes the server subscription by endpoint before unsubscribing the browser | ported |
| core/push.service.spec.ts › PushService › keeps the browser subscription when the server removal fails | lib/push.test.ts › PushService › keeps the browser subscription when the server removal fails | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › posts the login without cookie flags and keeps the refresh token in secure storage only | lib/http.test.ts › Http native bearer with TokenStore › posts the login without cookie flags and keeps the refresh token in secure storage only | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › attaches the bearer token to /api calls after sign-in | lib/http.test.ts › Http native bearer with TokenStore › attaches the bearer token to /api calls after sign-in | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › never sends the token to another origin | lib/http.test.ts › Http native bearer with TokenStore › never sends the token to another origin | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › keeps the refresh token out of secure storage when persist is off, yet still refreshes it | lib/http.test.ts › Http native bearer with TokenStore › keeps the refresh token out of secure storage when persist is off, yet still refreshes it | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › refreshes once for two concurrent 401s and retries both with the new token | lib/http.test.ts › Http native bearer with TokenStore › refreshes once for two concurrent 401s and retries both with the new token | ported |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › clears the stored token when the refresh fails and passes the original 401 on | lib/http.test.ts › Http native bearer with TokenStore › clears the stored token when the refresh fails and passes the original 401 on | ported (`ApiError` has no URL; the two 401s carry different problem details instead) |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › passes the refresh error (503) on and keeps the stored token when the refresh fails transiently | lib/http.test.ts › Http native bearer with TokenStore › passes the refresh error (503) on and keeps the stored token when the refresh fails transiently | ported (same adaptation) |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › passes the refresh error (429) on and keeps the stored token when the refresh fails transiently | lib/http.test.ts › Http native bearer with TokenStore › passes the refresh error (429) on and keeps the stored token when the refresh fails transiently | ported (same adaptation) |
| core/native/bearer.interceptor.spec.ts › bearerInterceptor with TokenStore › never refreshes a 401 from the login endpoint | lib/http.test.ts › Http native bearer with TokenStore › never refreshes a 401 from the login endpoint | ported |
| core/native/token-store.spec.ts › TokenStore › resolves false without a request when there is no refresh token | lib/native/token-store.test.ts › TokenStore › resolves false without a request when there is no refresh token | ported |
| core/native/token-store.spec.ts › TokenStore › restores a session from the persisted refresh token after a restart | lib/native/token-store.test.ts › TokenStore › restores a session from the persisted refresh token after a restart | ported |
| core/native/token-store.spec.ts › TokenStore › keeps the stored refresh token when the refresh fails with a server error | lib/native/token-store.test.ts › TokenStore › keeps the stored refresh token when the refresh fails with a server error | ported |
| core/native/token-store.spec.ts › TokenStore › forgets the stored refresh token when the server refuses it | lib/native/token-store.test.ts › TokenStore › forgets the stored refresh token when the server refuses it | ported |
| core/native/token-store.spec.ts › TokenStore › discards a refresh that completes after clear, so logout stays signed out | lib/native/token-store.test.ts › TokenStore › discards a refresh that completes after clear, so logout stays signed out | ported |
| core/native/token-store.spec.ts › TokenStore › forgets both tokens on clear | lib/native/token-store.test.ts › TokenStore › forgets both tokens on clear | ported |
| features/today/today.spec.ts › TodayPage › looks up low days for the local day reloaded from the server, not the stale cached one | pages/today.test.tsx › TodayPage › looks up low days for the local day reloaded from the server, not the stale cached one | ported |
| features/habits/habit-edit.spec.ts › HabitEditPage reminder channels › drops mobile when Discord DM is added to a mobile-only habit | pages/habit-edit.test.tsx › HabitEditPage › drops mobile when Discord DM is added to a mobile-only habit | ported |
| features/habits/habit-edit.spec.ts › HabitEditPage reminder channels › drops mobile when Web push is added to a mobile-only habit | pages/habit-edit.test.tsx › HabitEditPage › drops mobile when Web push is added to a mobile-only habit | ported |
| features/settings/settings.spec.ts › SettingsPage › sends quick successive grace changes one PATCH at a time, in order | pages/settings.test.tsx › SettingsPage › sends quick successive grace changes one PATCH at a time, in order | ported |

New React tests without an Angular original:

- `lib/problem.test.ts › asApiError › passes an ApiError through and reads a fetch network failure as status 0` (the fetch `TypeError` path that replaces `HttpErrorResponse` status 0).
- `lib/store.test.ts › Store › notifies only on a real change and stops after unsubscribe` (the `Store` contract that replaces Angular signals).

No original test was dropped or merged in S1.

New S2 tests without an Angular original (the brief's behavior list and the review fixes the ported specs didn't pin):

- `lib/http.test.ts › Http URLs › URI-encodes query values and leaves out undefined ones`
- `lib/http.test.ts › Http XSRF and cookies › sends the cookie token on a relative POST|PUT|PATCH|DELETE in the web build, with same-origin credentials` (4 cases)
- `lib/http.test.ts › Http XSRF and cookies › sends no XSRF header on a GET or to an absolute URL`
- `lib/http.test.ts › Http XSRF and cookies › sends neither cookies nor an XSRF header in the native build`
- `lib/http.test.ts › Http errors › reads a network TypeError as an ApiError with status 0`
- `lib/http.test.ts › Http habit write hook › calls onHabitWrite after a successful habit write, but not for a GET, a replay or a failure` (replaces `reminderTriggerInterceptor`)
- `lib/http.test.ts › Http native bearer with TokenStore › refreshes and retries a 401 instead of ending the session, while the web build ends it`
- `lib/http.test.ts › Http native bearer with TokenStore › sends every native call, login and refresh included, to the absolute API base`
- `lib/api-client.test.ts › ApiClient offline day edits › queues a check-in answered by a 504 without a problem body (the service worker offline answer)`
- `lib/api-client.test.ts › ApiClient offline day edits › rejects a 504 that carries a problem body and queues nothing`
- `lib/api-client.test.ts › ApiClient offline day edits › queues a new edit behind still-queued ones instead of sending it ahead of them`
- `lib/api-client.test.ts › ApiClient export › downloads the export as a blob named by Content-Disposition`
- `lib/auth.test.ts › AuthService › logout › in the native build wipes reminders, then tokens, then the queue, then the remembered channels, without a request`
- `lib/push.test.ts › PushService › stays unavailable and asks the server nothing without a service worker`
- `lib/device-sync.test.ts › DeviceSync › rebuilds the reminders in the new time zone as soon as me holds it`
- `lib/native/reminders.test.ts › Reminders › offline, plans from the cached habits with the queued check-in applied, so today's reminder is cancelled`
- `lib/native/reminders.test.ts › Reminders › schedules nothing from the cache when the API answers 401`
- `lib/native/reminders.test.ts › Reminders › plans from the live habit list and caches it`
- `lib/native/token-store.test.ts`: the transient and refusal cases also assert `lastTransientError`.
- `sw-handlers.test.ts › handlePush › shows the bot payload with its title and body and passes the click data through`
- `sw-handlers.test.ts › handlePush › still shows an "Ember" notification for …` (5 malformed payloads)
- `sw-handlers.test.ts › handleNotificationClick › focuses an open window of this origin and moves it to the target`
- `sw-handlers.test.ts › handleNotificationClick › only focuses a window that already shows the target`
- `sw-handlers.test.ts › handleNotificationClick › opens /today when no window of this origin is open`
- `sw-handlers.test.ts › handleNotificationClick › opens /today instead of …` (absolute, protocol-relative, missing URL)

No original test was dropped or merged in S2; only Angular plumbing changed (`HttpTestingController` → the `fetch` fake in `lib/test-support.ts`, `SwPush` → a fake `PushManager`, `Router` → `setNavigator`).

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

S2 had no shell, so each mutation below names the exact revert and the test that must fail; the lead runs them. Paths relative to `web/src/`.

| Fix (source) | React test | Mutation-checked (how) |
| --- | --- | --- |
| Antiforgery retry with the fresh token (web-P6 R1 #1) | lib/http.test.ts › Http errors › refreshes the antiforgery token once and retries the POST with the new token, whose success reaches the caller | killed (lead run 2026-11-01, test fails with the revert): in `lib/http.ts` `exchange()`, memoise the token (`xsrf = (cached ??= readCookie('XSRF-TOKEN'))` with a module-level `let cached`), so the retry reuses `stale`; and separately delete the `if (error.status === 403 && error.type === 'antiforgery' && !retried) { … }` block in `send()` |
| Logout removes the server push subscription, then unsubscribes the browser (R1 #3) | lib/auth.test.ts › AuthService › logout › removes the push subscription before signing out, then refreshes antiforgery and clears the session; lib/push.test.ts › PushService › removes the server subscription by endpoint before unsubscribing the browser | killed (lead run 2026-11-01, test fails with the revert): swap the two `await` lines in `PushService.release()` (auth test) and in `PushService.unsubscribe()` (push test) in `lib/push.ts` |
| A refresh racing logout can't restore the session (R4 security medium, epoch) | lib/native/token-store.test.ts › TokenStore › discards a refresh that completes after clear, so logout stays signed out | killed (lead run 2026-11-01, test fails with the revert): delete `if (epoch !== this.epoch) return false;` in `TokenStore.runRefresh()` (`lib/native/token-store.ts`) |
| Wipe order reminders → tokens → queue/cache → localStorage (R4) | lib/auth.test.ts › AuthService › logout › in the native build wipes reminders, then tokens, then the queue, then the remembered channels, without a request | killed (lead run 2026-11-01, test fails with the revert): in `AuthService.wipeDevice()` (`lib/auth.ts`) swap `await this.native.reminders.clearAll();` and `await this.native.tokens.clear();`; and separately move the `Object.keys(localStorage)…` statement above `if (userId) await this.queue.clear(userId);` |
| No cache fallback on 401 (R4) | lib/native/reminders.test.ts › Reminders › schedules nothing from the cache when the API answers 401 | killed (lead run 2026-11-01, test fails with the revert): delete `if (asApiError(error).status === 401) return;` in `Reminders.run()` (`lib/native/reminders.ts`) |
| Leftover `channelsBeforePhone` keys wiped (R4) | lib/auth.test.ts › AuthService › logout › wipes the user's queued edits and remembered phone channels from the device | killed (lead run 2026-11-01, test fails with the revert): delete the `Object.keys(localStorage).filter(…).forEach(…)` statement in `AuthService.wipeDevice()` |
| Clear tokens only on a 400/401 refusal (R4 code high) | lib/native/token-store.test.ts › TokenStore › keeps the stored refresh token when the refresh fails with a server error; lib/http.test.ts › Http native bearer with TokenStore › passes the refresh error (503) / (429) on and keeps the stored token when the refresh fails transiently | killed (lead run 2026-11-01, test fails with the revert): in `TokenStore.runRefresh()` replace the `if (apiError.status === 400 \|\| apiError.status === 401) { … } else { … }` with an unconditional `if (epoch === this.epoch) await this.clear();` |
| Timezone rebuild uses the new zone (R4 medium) | lib/device-sync.test.ts › DeviceSync › rebuilds the reminders in the new time zone as soon as me holds it | killed (lead run 2026-11-01, test fails with the revert): delete the `if (timeZone !== this.timeZone) { … }` block in `DeviceSync.follow()` (`lib/device-sync.ts`) |
| Queue order versus new online edits (R4 medium) | lib/api-client.test.ts › ApiClient offline day edits › queues a new edit behind still-queued ones instead of sending it ahead of them | killed (lead run 2026-11-01, test fails with the revert): delete the first `if (known && this.offline.pending.get() > 0 && …) { … }` in `ApiClient.dayEdit()` (`lib/api-client.ts`) |
| An offline check-in cancels today's reminder (R4 medium) | lib/native/reminders.test.ts › Reminders › offline, plans from the cached habits with the queued check-in applied, so today's reminder is cancelled | killed (lead run 2026-11-01, test fails with the revert): in `Reminders.run()` replace the `cached.habits.map(… .reduce(withDayEdit, habit))` assignment with `habits = cached.habits;` |
| Edits queued during a replay are sent in the same replay (2c7a918) | lib/offline-queue.test.ts › OfflineQueue › sends an edit queued while a replay is running in that same replay | killed (lead run 2026-11-01, test fails with the revert): in `OfflineQueue.run()` (`lib/offline-queue.ts`) replace the outer `for (let queued = await load(); …; queued = await load())` with a single `const queued = await load();` pass |
| A transient refresh error passes on and keeps the stored token (4a1ee54) | lib/http.test.ts › Http native bearer with TokenStore › passes the refresh error (503) / (429) on and keeps the stored token when the refresh fails transiently | killed (lead run 2026-11-01, test fails with the revert): delete `if (bearer.lastTransientError) throw bearer.lastTransientError;` in `Http.authorized()` (`lib/http.ts`); the keep-the-token half is the 400/401 row above |
| Push `claim` re-registers, makes no call without a subscription, never throws on 501 or 500 (4a1ee54) | lib/push.test.ts › PushService › claim re-registers the existing browser subscription once; › claim makes no call without a browser subscription; › claim makes no call and does not throw when the server offers no push; › claim does not throw when the server rejects the registration | killed (lead run 2026-11-01, each revert fails its test), in `PushService.claim()` (`lib/push.ts`): delete the `addPushSubscription` line (first test); change the guard to `if (!this.available.get()) return;` with `body!` (second); change it to `if (!body) return;` (third); drop `.catch(() => undefined)` (fourth) |
| Login 401 is a form error, never "session ended" (web-P6 R1, contract) | pages/login.test.tsx › shows a wrong password as a form alert saying the details do not match, never as a session end | killed (lead run 2026-11-01): `problemToMessage(…, 'login')` → default context |
| `returnUrl` open-redirect guard on screens (web-P6 R1 #4) | pages/login.test.tsx › ignores an off-site returnUrl…; pages/consent.test.tsx › falls back to /today for an off-site returnUrl | killed: `safeReturnUrl(...)` → raw param |
| Confirm-email strips `code` and sends the password-bound body (v1.2) | pages/confirm-email.test.tsx › removes the code from the address bar, then confirms with the user id, code and password | killed: strip effect disabled |
| Consent posts the current policy version | pages/consent.test.tsx › agrees to the current policy version, reloads me and lands on the returnUrl | killed: `policyVersion` sent instead |
| Stale `me.localToday` after midnight: Today/History/Habit edit reload me (web-P6 R1 #2) | pages/today.test.tsx › looks up low days for the local day reloaded from the server…; pages/habit-edit.test.tsx (reload) | killed for Today and Habit edit: `auth.loadMe(true)` removed; History has the same line, no dedicated test |
| Late rollback guard (web-P6 R1 re-check) | pages/today.test.tsx › keeps a newer state when a stale check-in failure arrives after it | killed: rollback made unconditional |
| Adding Discord DM / Web push to a mobile-only habit drops `mobile` (4a1ee54) | pages/habit-edit.test.tsx › drops mobile when Discord DM / Web push is added to a mobile-only habit | killed: filter removed |
| Escape ignored while the habit delete is in flight (web-P6 R1 re-check) | pages/habit-edit.test.tsx › cancels the delete confirm with Escape, but ignores Escape while the delete is in flight | killed: guard removed |
| S2 security low: XSRF header only to the same origin after the API base | lib/http.test.ts › sends no XSRF header to a configured API base on another origin | killed |
| S2 security low: no `me` restore after sign-out | lib/auth.test.ts › leaves me null when the response arrives after the session was cleared | killed |
| S2 code lows: malformed cookie, no push wait without a worker, notification click fallback, guards | lib/http.test.ts, lib/push.test.ts, sw-handlers.test.ts, lib/guards.test.ts | each killed |
| Settings autosaves serialized (web-P6 R1 #5) | pages/settings.test.tsx › sends quick successive grace changes one PATCH at a time, in order; › waits for the grace PATCH before sending the leaderboard one | killed (lead run 2026-11-01): chain replaced by `Promise.resolve()` |
| Settings reloads `me` on entry (web-P6 R1 #2) | pages/settings.test.tsx (every case waits for the reload) | killed: reload removed |
| Push UI hidden on 501 (contract v1.3) | pages/settings.test.tsx › hides the notifications section when the server answers 501 for the push key | killed |
| Delete account lands on `/login?reason=deleted` (e2e contract) | pages/settings.test.tsx › deletes the account with the password and lands on /login?reason=deleted | killed |
| Merge lands on Settings with the linked notice | pages/link-merge.test.tsx › lists each habit as one item, then moves everything and lands on Settings | killed |
| Legal markdown cannot inject HTML (Angular sanitized `[innerHTML]`) | pages/legal.test.tsx › renders raw HTML from the markdown as text, never as elements; › renders a javascript: link as plain text… | killed (both) |
| S3 review: no cached data across users | query-client.test.ts › forgets the previous user's cached data… | killed: clear removed |
| S3 review: History day panel closes on month change | pages/history.test.tsx › closes the open day when the month changes… | killed |
| S3 review: Today reloads after a check-in interrupts a sync refetch | pages/today.test.tsx › shows the synced list after a check-in that interrupted a sync refetch | killed |

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
