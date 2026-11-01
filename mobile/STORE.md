# Ember Android app: store submission prep

Status: prep only. The Android project does not exist in the repo yet (no `capacitor.config.*`, no `android/` folder). iOS is parked (section 3). Nothing is submitted and no store account exists yet.

Sources: `docs/legal/datenschutzerklaerung.md`, `docs/legal/README.md`, `docs/contracts/api-v1.md` (v1.3), `docs/v2-plan.md` (Phase 7). Code facts were checked on 2026-11-01. Store rules and fees come from memory and must be checked in the Play Console and the Apple Developer site before submitting.

Marker: `TODO (Nico):` means the answer depends on a decision or fact that is not made yet.

## 0. Blockers before anything is published

1. **The privacy policy draft describes the old Discord bot, not the app.** It says "keine E-Mail-Adresse, kein Passwort" and "keine Cookies ... Ember läuft komplett innerhalb von Discord". Both are wrong for v2. Accounts use email and password. The web app uses cookies (the sign-in cookie and the `XSRF-TOKEN` cookie). The app runs outside Discord. The draft also misses web push, mobile reminders and on-device storage. Rewrite it before it gets a public URL. The copy in `web/public/legal/` has the same lines.
2. **Some policy promises are not true yet.** Logs are "deleted after 30 days" and backups are "daily, kept 30 days". The legal README lists both as open. Store answers about deletion and retention depend on them.
3. **No public URL.** Both stores need a link that opens without the app. The in-app copy is bundled, but it does not count.

## 1. Summary: what Nico must do, pay or decide

| # | Item | Who / cost | Status | Note |
|---|---|---|---|---|
| 1 | Google Play Console account | Nico, $25 once | TODO (Nico) | Personal accounts may need ID checks and a closed test (12 testers, 14 days) before production access. Check at sign-up. |
| 2 | Apple Developer Program | Nico, $99 per year | Parked | Only for iOS (section 3). |
| 3 | Application ID | free | Provisional: `app.ember.habits` | Play fixes it on the first upload. Not set anywhere in the repo yet. TODO (Nico): confirm. |
| 4 | Privacy policy rewrite and public URL | Nico | Blocker (section 0) | TODO (Nico): pick the hosting URL (homeserver now, VPS in Phase 8). |
| 5 | Upload signing key | free | Open | Use Play App Signing. Back up the upload key outside the repo. Never commit it. |
| 6 | Content rating (IARC questionnaire) | free | Open | No user-to-user content in the app. Answer after the feature set is final. |
| 7 | Target audience and minimum age | Nico | TODO (Nico) | Recommend 16+ or 18+. Do not target children (Play's Families policy would apply). Policy placeholder `[MINDESTALTER]`. |
| 8 | Support email | Nico | Placeholder | Shown in the listing and the policy (`[E-MAIL]`). |
| 9 | Developer name, address, trader status | Nico | TODO (Nico) | Play shows contact details publicly. The EU asks whether the developer is a trader. Ember is free and private, so you may be a non-trader. Confirm. |
| 10 | Listing: icon, screenshots, text | Nico | Open | Use neutral example habits. No medical claims (section 2.2). |
| 11 | Reviewer test account | Nico | Open | Both stores need a working login. Create one with synthetic data, keep the credentials in a password manager, and enter them only in the store forms. |
| 12 | Health data decisions | Nico | TODO (Nico) | Play category and Health apps declaration (section 2.2). |
| 13 | Exact alarm permission | Nico | TODO (Nico) | Keep it with the justification, or drop it (section 2.3). |

Build and code gaps are in section 4.3.

## 2. Google Play

### 2.1 Data safety form

Answers for the planned app. "Collected" means data leaves the device for Ember's server. Categories follow Play's data types.

| Play data type | Collected | Shared | Required or optional | Purpose | Encrypted in transit | Deletion possible |
|---|---|---|---|---|---|---|
| Personal info: Email address | Yes | See note | Required (email login) | Account management, app functionality | Yes | Yes |
| Personal info: User IDs (Discord user ID) | Yes | See note | Optional (only if Discord is linked) | Account management, app functionality | Yes | Yes |
| Personal info: Other (password) | Yes | No | Required | Account management. The server stores a hash only. TODO (Nico): confirm which Play category expects passwords. | Yes | Yes |
| Health info (habit names, check-ins, low days) | Yes | See note | Required to use habits | App functionality | Yes | Yes |
| Other info (timezone, reminder times, pause dates, grace days, consent record, leaderboard choice) | Yes | No | Mostly optional. Consent record is required. | App functionality, account management | Yes | Yes |
| Location | No | n/a | n/a | n/a | n/a | n/a |
| Device or other IDs | No | n/a | n/a | n/a | n/a | n/a |

Notes:

- **Shared.** The app talks only to Ember's API. Discord is used as a sign-in provider in the browser. The Discord bot also sends reminder DMs that name the habit (`src/Ember.Bot/Services/DiscordDmReminderChannel.cs`). Play may treat that as sharing. Recommendation: mark Health info and User IDs as shared with Discord, purpose "App functionality". Answering "No" is only defensible if you treat Discord as part of your own service. TODO (Nico): decide, and check Play's definition of "sharing".
- **Health info** is the conservative choice for habit data, which the policy treats as health data under GDPR Art. 9. Check-ins are not a separate "App activity" type.
- **Device IDs: No** for v2, because the app has no push token. Re-check if server push is added (Phase 7.3).
- **Location: No.** The timezone is picked from a list or auto-detected as a zone name. No location permission is requested. TODO (Nico): confirm that auto-detect reads only the zone name.
- **App info and performance: No.** No crash reporting. Revisit if Sentry is added (Phase 8.5).
- **Security practices.** Encrypted in transit: Yes (the API requires HTTPS outside development). Users can request deletion: Yes (in the app and on the web, section 2.4). Independent security review: No, unless one is commissioned.

### 2.2 Health apps declaration

Ember handles data the policy treats as health data. It is not a medical app.

- **Category (recommended):** Health & Fitness, declared as a non-medical wellness app for habit tracking. TODO (Nico): pick the exact option from the Console list. I could not check the current list from this session.
- **Why not "Productivity" to avoid the declaration.** The data is health data under our own policy. An understated category is the kind of mismatch Play reviews.
- **Not a medical device and not a DiGA.** Ember makes no diagnosis, treatment or monitoring claim, and N8 rules out DiGA features in v2. TODO (Nico): have the "not a medical device" position checked (EU MDR scope) before you rely on it.
- **Listing rules.** Use neutral example habits in screenshots (for example water or a walk). Avoid "treat", "therapy", "symptom", "medication adherence" and "clinical". Do not show the medication template ("Medikamente nehmen") in store images.

### 2.3 Permissions

Verified against the notifications plugin manifest (`web/node_modules/@capacitor/local-notifications/android/src/main/AndroidManifest.xml`). The merged app manifest is not checked yet because the Android project does not exist.

| Permission | Source | Why | Declaration |
|---|---|---|---|
| INTERNET | Capacitor Android template. Not in the plugin manifest. Confirm in the merged manifest. | Talk to the Ember API | None |
| POST_NOTIFICATIONS | Notifications plugin | Android 13+ runtime prompt. Reminders stay off until the user allows them. | Runtime prompt only |
| SCHEDULE_EXACT_ALARM | Notifications plugin | Fire each reminder at the chosen minute | Play permission declaration (below) |
| RECEIVE_BOOT_COMPLETED | Notifications plugin | Restore scheduled reminders after a reboot | None |
| WAKE_LOCK | Notifications plugin | Declared by the plugin. Keep as merged. | None |

**Exact alarm justification** (paste into the Console declaration):

```text
Ember sends habit reminders at the time the user picks for each habit, for example 09:00. The exact alarm permission makes each reminder fire at that minute. Reminders are a core feature of the app. If the user denies the permission, the app still sends reminders, at an approximate time.
```

Risks:

- Play limits exact alarms to apps whose core function needs them. Its examples are alarm clock and calendar apps. A habit reminder may be judged not core, which can lead to rejection or a request to remove the permission. Check the current Play wording.
- On Android 14 and later, exact alarms are, as I understand it, not granted by default to newly installed apps. Many users may get approximate reminders. Test this on a device.
- **Fallback:** drop `SCHEDULE_EXACT_ALARM` and accept approximate reminders. TODO (Nico): decide before the first upload.

### 2.4 Account deletion

Play requires two things for apps where users create accounts:

1. **In-app deletion.** Ember has it: Settings, section "Delete your account", button "Delete my account". It is the same Angular screen the app wraps. It needs the password, or the typed word DELETE when the account has no password (`POST /api/me/delete`). Test it on a device, including that device data is wiped (section 4.3).
2. **A web link** to request deletion, listed in the Data safety form. It must work for someone who no longer has the app.

Current state: there is no public deletion page. The route list in `web/src/app/app.routes.ts` has none. `/settings` needs sign-in, so it fails the "no app needed" test for a user who has forgotten the password. Recommendation: add a public page with the deletion steps, for example `{WebOrigin}/delete-account`. That page is not built. Until it exists, `{WebOrigin}/settings` is the only option.

Deletion form answers. Play asks what is deleted and what is kept.

- **Deleted:** everything in section 2.1, including the consent record and the Discord link.
- **Kept:** server logs and backups, up to 30 days each. This is true only once the policy promises in section 0 are met. TODO (Nico).

## 3. Apple App Store (parked, prepared)

Do not submit. This section is ready for when iOS starts.

### 3.1 App Privacy labels

Apple asks for "linked to you", "not linked to you" and "used to track you". Ember uses only "linked to you" and does no tracking.

| Apple data type | Linked to user | Used to track | Purpose | Note |
|---|---|---|---|---|
| Health & Fitness: Health | Yes | No | App Functionality | Habit names, check-ins, low days |
| Contact Info: Email Address | Yes | No | App Functionality | Login and account mail |
| Identifiers: User ID | Yes | No | App Functionality | Ember account ID, and the Discord user ID if linked |
| Other Data: Other Data Types | Yes | No | App Functionality | Timezone, reminder times, pause dates, consent record |
| Usage Data, Diagnostics, Location, Purchases | No | No | n/a | No analytics, no crash SDK, no location, no in-app purchases. TODO (Nico): revisit if Sentry is added. |

- **Tracking:** No. No App Tracking Transparency prompt is needed.
- **Purposes:** App Functionality only. No analytics, advertising or personalization.
- **Privacy policy URL:** the same URL as Play. It goes in App Store Connect and in the app.

### 3.2 Guideline 5.1.1(v): account deletion

Apps that let users create an account must let them start deletion inside the app. A web link alone does not meet this. Ember's Settings deletion (section 2.4) meets it if it works in the native build. Test that the account, habits, check-ins and device data are removed and the user is signed out.

TODO (Nico): check the current wording of 5.1.1(v) before submission. This paragraph is from memory.

### 3.3 Guideline 5.1.3: health data

From memory (verify the current text): health data may not be used for ads or marketing, may not be sold, and may not be shared with third parties beyond what the service needs. The privacy policy must say this. Ember's planned behaviour matches it. The HealthKit rules do not apply because Ember does not use HealthKit. Keep it that way.

### 3.4 Sign in with Apple (guideline 4.8)

Not required if the app offers no third-party or social login. Ember's login is email and password. Discord is used only for an optional link, which happens in the system browser from the web Settings page, and the app's login screen must not offer Discord.

Risk: a reviewer may read "Link Discord" in Settings as third-party login. TODO (Nico): keep Discord off the app's login screen, and confirm guideline 4.8 before submission. If Apple disagrees, add Sign in with Apple.

### 3.5 Other iOS items

- **Export compliance.** The app uses only HTTPS. TODO (Nico): answer the encryption question in App Store Connect.
- **Age rating.** No medical treatment information, no user-to-user content. Answer after the feature set is final.
- **Bundle ID.** `app.ember.habits` is the candidate. Apple locks a bundle ID once registered, and it cannot be reused after deletion. TODO (Nico): confirm it matches Play.
- **Device backups.** Android backup is off. On iOS, check whether device backups include the WebView storage (IndexedDB). I could not confirm this from the repo. TODO: decide and test.
- **Privacy manifest.** Check that the app's privacy manifest covers the required-reason APIs its plugins use. Not verified here.

## 4. Open items and placeholders

### 4.1 Placeholders in the legal texts

From `docs/legal/README.md`:

| Placeholder | Where | Owner |
|---|---|---|
| `[NAME]`, `[ANSCHRIFT: ...]`, `[E-MAIL]` | Privacy policy, Impressum | Nico |
| `[DATUM]` (Stand) | Privacy policy | Nico, at publication |
| `[MINDESTALTER]` | Privacy policy section 10 | Nico (see section 1, item 7) |
| `[NAME/ANSCHRIFT/WEBSITE DER AUFSICHTSBEHÖRDE]` | Privacy policy section 9 | Nico |
| `[ZU PRÜFEN: ...]` (Discord EEA entity and transfer basis) | Privacy policy section 6.1 | Nico, with a legal check |
| `[VPS-ANBIETER, Sitz]`, `[LAND IN DER EU]` | Privacy policy section 6.2 | Only after the VPS move (Phase 8) |

### 4.2 Open decisions and facts

- Public URL for the privacy policy and the deletion page. TODO (Nico).
- Privacy policy rewrite for the app (section 0). TODO (Nico), then the legal check.
- Legal questions 1, 3, 4 and 5 in `docs/legal/README.md` (Art. 9 consent, minimum age, Discord controller, Discord transfer basis).
- Retention promises: make logs and backups true, or change the text.
- Play account type and identity checks. TODO (Nico).
- Play target API level at upload, and the upload format (Android App Bundle). TODO: check the Console's current requirement.
- `versionCode` and `versionName`: no scheme set yet. TODO (Nico).
- Reviewer test account (section 1, item 11). TODO (Nico).
- Support email. TODO (Nico).
- Store listing language: English, German optional. TODO (Nico).
- Trader status and developer address. TODO (Nico).
- Exact alarm permission: keep or drop (section 2.3). TODO (Nico).
- Health apps category (section 2.2). TODO (Nico).
- Discord sharing answer in the Data safety form (section 2.1). TODO (Nico).
- `web/src/environments/environment.mobile.ts` still has the placeholders `https://ember.invalid`. Set `apiBase` and `webOrigin` to the deployed `Ember__WebOrigin` before building.

### 4.3 Code gaps found while writing this

1. **No Android project.** There is no `capacitor.config.*` and no `android/` folder. The app ID, `allowBackup=false`, the merged permissions and INTERNET cannot be checked until it exists.
2. **Native CORS origins are missing.** Contract v1.3 requires `Ember__NativeOrigins` (`https://localhost` and `capacitor://localhost`). `src/Ember.Api/ApiApp.cs` allows only the web origin, with credentials. The app's API calls will fail.
3. **Device data is not wiped on logout or deletion.** `OfflineQueue.clear` (`web/src/app/core/offline-queue.ts`, line 60) has no callers. The store copy and the device-store comment both say the data is wiped.
4. **Local reminders are not wired.** `@capacitor/local-notifications` is listed in `web/package.json`, but no code schedules or cancels notifications.
5. **Token storage is not wired.** `@aparajita/capacitor-secure-storage` is listed, and its Android code uses AndroidKeyStore (checked in the plugin source). No app code imports it yet.
6. **No public deletion page** (section 2.4).

Note: `web/package.json` and `web/bun.lock` have uncommitted Capacitor changes. They are not part of this doc and were not touched.

## Changelog

Nothing to release yet. Store builds start with the first Android build.
