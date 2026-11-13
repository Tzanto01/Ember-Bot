# Ember Android app: store submission prep

Status: the Android app (`web/capacitor.config.ts`, `mobile/android`) builds as a debug APK and a signed release APK or AAB (section 5) and has run on an emulator (Android 17). Nothing is submitted and no store account exists yet. iOS is parked (section 3).

Sources: `web/public/legal/datenschutzerklaerung.md` (the privacy policy; `docs/legal/` points there), `docs/legal/README.md`, the merged APK manifest (`aapt2 dump badging`) and the app code. Store rules and fees come from memory and must be checked in the Play Console before submitting.

Marker: `TODO (Nico):` means the answer depends on a decision or fact that is not made yet.

## What the app does (for the store answers)

A calm companion for hard moments and gentle days. And on the other days: gentle habits.

- **"I need a moment".** A short guided flow (notice, name, ride it out, optionally reflect) that runs on the device, works signed out and offline, makes no API call and stores nothing. Crisis lines are one tap away inside the flow. Ember is not a crisis service. Doors on Android: a launcher shortcut, a 1x1 "I need a moment" widget that shows no user data, and a button in the "Today in Ember" widget.
- **Two modes.** With an account (email and password, or Discord), data syncs with Ember's server. Without an account ("No account (device only)"), everything stays on the phone and nothing is sent to the server.
- **Habits and check-ins**, routines, low days, pauses and grace days. Streaks are optional ("Show streaks", off for new accounts).
- **Journal:** a day note (text) and a mood per day, with the user's own moods. Stored in plain text on the server, unless the user turns on the **private journal**: then notes and own moods are encrypted on the device (AES-GCM, key wrapped with a passphrase and a recovery code) and the server only holds ciphertext.
- **Phone reminders** are local notifications planned on the device for the next 14 days (up to 400). The lock-screen text names no habit unless the user turns on "Show habit names in reminders".
- **Home-screen widget** "Today in Ember": today's habits from app-private storage, tap a row to check in. Signing out clears it.
- **Backup file export** (no-account mode): the user saves a file with their data where they choose. It is not sent to Ember.
- **Not in the app:** no leaderboard, no ads, no analytics, no crash reporting, no location, no server push (no push token on Android).

## 0. Blockers before anything is published

1. **Public URLs.** Play needs a privacy policy URL and an account-deletion URL that open without the app. The policy text is rewritten for v2 (`web/public/legal/datenschutzerklaerung.md`) and still has open `[PRÜFEN: ...]` notes. TODO (Nico): confirm the public URL on the final domain.
2. **No public account-deletion page** (section 2.4).

## 1. Summary: what Nico must do, pay or decide

| # | Item | Who / cost | Status | Note |
|---|---|---|---|---|
| 1 | Google Play Console account | Nico, $25 once | TODO (Nico) | Personal accounts may need ID checks and a closed test (12 testers, 14 days) before production access. Check at sign-up. |
| 2 | Apple Developer Program | Nico, $99 per year | Parked | Only for iOS (section 3). |
| 3 | Application ID | free | Set: `app.ember.habits` | In `web/capacitor.config.ts` and `mobile/android/app/build.gradle`. Play fixes it on the first upload. TODO (Nico): confirm. |
| 4 | Privacy policy public URL | Nico | Blocker (section 0) | Resolve the `[PRÜFEN: ...]` notes first. |
| 5 | Upload signing key | free | Build wired (section 5) | Use Play App Signing. Keep the upload keystore and its passwords outside the repo, backed up. |
| 6 | Content rating (IARC questionnaire) | free | Open | No user-to-user content in the app. |
| 7 | Target audience and minimum age | Nico | TODO (Nico) | Do not target children (Play's Families policy would apply). Match section 10 of the policy. |
| 8 | Support email | Nico | TODO (Nico) | Shown in the listing. |
| 9 | Developer name, address, trader status | Nico | TODO (Nico) | Play shows contact details publicly. Ember is free and private, so you may be a non-trader. Confirm. |
| 10 | Listing: icon, screenshots, text | Nico | Open | Use neutral example habits. No medical claims (section 2.2). |
| 11 | Reviewer test account | Nico | Open | Create one with synthetic data, keep the credentials in a password manager, enter them only in the store form. Reviewers can also use no-account mode. |
| 12 | Health data decisions | Nico | TODO (Nico) | Play category and Health apps declaration (section 2.2). |
| 13 | versionCode scheme | Nico | TODO (Nico) | Any rising integer works, for example 1, 2, 3 per upload (section 5). |

## 2. Google Play

### 2.1 Data safety form

"Collected" means data leaves the device for Ember's server. No-account mode collects nothing; the form describes the app as a whole, so answer for account mode.

| Play data type | Collected | Shared | Required or optional | Purpose | Note |
|---|---|---|---|---|---|
| Personal info: Email address | Yes | No | Required for an email login | Account management, app functionality | Accounts created through Discord have none |
| Personal info: User IDs (Discord user ID) | Yes | See note | Optional (only if Discord is linked) | Account management, app functionality | |
| Personal info: Other (password hash, two-factor secret and recovery codes) | Yes | No | Password required, 2FA optional | Account management, security | TODO (Nico): confirm which Play type fits passwords |
| Health and fitness: Health info (habit names, check-ins, low days, routines, moods) | Yes | See note | Required to use habits; moods optional | App functionality | Conservative choice: the policy treats this as health data (Art. 9 GDPR) |
| App activity: Other user-generated content (day notes) | Yes | No | Optional | App functionality | Plain text unless the private journal is on |
| App info and performance | No | n/a | n/a | n/a | No crash reporting or analytics |
| Other info (timezone, theme, grace days, reminder times and channels, pause dates, consent record) | Yes | No | Mostly optional; the consent record is required | App functionality, account management | |
| Location | No | n/a | n/a | n/a | Only the zone name is read from the device |
| Device or other IDs | No | n/a | n/a | n/a | No push token on Android |
| Files and docs | No | n/a | n/a | n/a | The backup file is saved by the user on the device, not sent |

Notes:

- **Private journal.** Notes and own moods encrypted on the device are unreadable for Ember. From memory, Play does not count end-to-end encrypted data as collected. TODO (Nico): check the current Play wording; listing day notes and moods as collected is the safe answer either way.
- **Shared.** The app talks only to Ember's API. The Discord bot sends reminder DMs that can name the habit, so Play may treat Health info and User IDs as shared with Discord. Email delivery (Brevo) and hosting are service providers acting for Ember, which Play does not count as sharing. TODO (Nico): decide the Discord answer.
- **Widget and phone reminders** read app-private storage on the device; nothing leaves the phone for them.
- **Security practices.** Encrypted in transit: Yes (HTTPS only, cleartext off). Users can request deletion: Yes (in the app and on the web, section 2.4). Independent security review: No.

### 2.2 Health apps declaration

Ember handles data the policy treats as health data. It is not a medical app.

- **Category (recommended):** Health & Fitness, declared as a non-medical wellness app for habit tracking. TODO (Nico): pick the exact option from the Console list.
- **Not a medical device.** Ember makes no diagnosis, treatment or monitoring claim. TODO (Nico): have that position checked (EU MDR scope) before relying on it.
- **Listing rules.** Use neutral example habits in screenshots (water, a walk). Avoid "treat", "therapy", "symptom", "medication adherence" and "clinical". Do not show the medication template in store images.

### 2.3 Permissions

From the merged manifest of the `play` build (the `beta` sideload build adds `REQUEST_INSTALL_PACKAGES` for its in-app updater, section 5):

| Permission | Source | Why | Declaration |
|---|---|---|---|
| INTERNET | App manifest | Talk to the Ember API (account mode) | None |
| POST_NOTIFICATIONS | Notifications plugin | Android 13+ runtime prompt. Asked when a phone reminder is turned on, and once on a new phone or after a reinstall when reminders already exist. | Runtime prompt only |
| RECEIVE_BOOT_COMPLETED | Notifications plugin | Restore scheduled reminders after a reboot | None |
| WAKE_LOCK | Notifications plugin | Declared by the plugin | None |
| `app.ember.habits.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX | Internal, signature-level | None |

`SCHEDULE_EXACT_ALARM` is removed from the Play manifest (`src/play/AndroidManifest.xml`, `tools:node="remove"`), so it needs no Play declaration. Play builds therefore use inexact alarms, which Android may deliver up to about an hour late. The sideloaded beta keeps the permission and asks once for "Alarms & reminders" so its reminders fire on time.

### 2.4 Account deletion

Play requires two things for apps where users create accounts:

1. **In-app deletion.** Settings, "Delete your account", button "Delete my account" (`POST /api/me/delete`). It needs the password, or the typed word DELETE when the account has no password. Deleting signs the phone out, which cancels reminders and clears the widget and device data.
2. **A web link** for someone who no longer has the app. There is no public deletion page yet; `/settings` needs sign-in. Recommendation: a public page with the deletion steps, for example `{WebOrigin}/delete-account`.

Deletion form answers. **Deleted:** everything in section 2.1, including the consent record and the Discord link. **Kept:** server logs (rotated by size) and database backups (up to about 5 weeks), as the policy says in sections 3.7 and 7.

### 2.5 Listing text

Provisional until Nico picks the pitch (`docs/contracts/companion-v1.md`, Copy deck). Wellness wording only: none of the words listed in `docs/contracts/companion-v1.md`, Ground rules.

- **Short description** (Play limit 80 characters, this is 51): A calm companion for hard moments and gentle days.
- **Full description** (Play limit 4000 characters):

```text
A calm companion for hard moments and gentle days.

When it gets too much, tap "I need a moment". Ember walks you through a few quiet steps: notice what is happening, name it, breathe and ride it out, and reflect afterwards if you want to. It runs on your phone, works without an account and offline, and keeps nothing you write. Crisis lines are always one tap away. Ember is not a crisis service: if you are in danger, call your local emergency number.

Reach the moment from a launcher shortcut, a small home-screen widget, or the Today widget.

And on the other days: gentle habits. Check in on the habits you choose, plan low days and pauses, keep a day note and a mood. Streaks are optional and off unless you turn them on.

Use Ember with an account to sync, or without one and keep everything on your phone. No ads, no analytics, no tracking.
```

## 3. Apple App Store (parked)

Do not submit. Kept for when iOS starts.

- **App Privacy labels.** Linked to the user, not used for tracking, purpose App Functionality: Health & Fitness (habits, check-ins, low days, moods), User Content (day notes), Contact Info (email), Identifiers (user ID, Discord ID if linked), Other Data (timezone, reminder times, consent record). No usage data, diagnostics, location or purchases.
- **5.1.1(v) account deletion:** in-app deletion exists (section 2.4). Test it in the native build.
- **5.1.3 health data:** no ads, no sale, no sharing beyond the service. No HealthKit.
- **4.8 Sign in with Apple:** the app's login screen offers email and Discord sign-in (Android shell only so far: an iOS shell needs the `app.ember.habits` URL scheme for the Discord return), which brings Sign in with Apple into scope. TODO (Nico): confirm the guideline before submission.
- **Other:** export compliance (HTTPS only), age rating, bundle ID `app.ember.habits`, whether device backups include the WebView storage, and the privacy manifest. TODO before an iOS build.

## 4. Open items

- Public URLs for the policy and the deletion page (section 0).
- The `[PRÜFEN: ...]` notes in the policy, including that no Google push is active (the Gradle file only applies the Google Services plugin when a `google-services.json` exists; the repo has none).
- Play account type, identity checks, trader status, support email, listing language. TODO (Nico).
- Health apps category and the Discord sharing answer (sections 2.1 and 2.2). TODO (Nico).
- Play target API level at upload: the app targets API 36. TODO: check the Console's current requirement.
- Build-time settings: the mobile build reads `VITE_API_BASE` and `VITE_WEB_ORIGIN` (`web/src/lib/env.ts`); set them to the deployed origin before a store build.
- Device checks still open: notification delivery under Doze, reboot, the widget on a real home screen at large font scale, and that the Keystore token store and backup exclusions (`allowBackup=false`, `data_extraction_rules.xml`) behave on a real phone.
- App links (confirm and reset links opening in the app) need `assetlinks.json` on the final domain. Not planned for v2; the links open in the browser.

## 5. Release build

Two product flavors, both with the application ID `app.ember.habits`:

| Flavor | For | Label | Differs |
|---|---|---|---|
| `beta` | Sideloaded beta APK | Ember Beta | Adds the `EmberUpdater` plugin (`src/beta/`), `REQUEST_INSTALL_PACKAGES` and an updates path for the FileProvider. On launch and on return (at most once an hour) it reads `{API base}/download/latest.json` and offers a newer `versionCode`; Android's installer always asks before installing. |
| `play` | Google Play | Ember | None of that: Play forbids self-updating apps. |

- Sideload: `./gradlew assembleBetaRelease`, APK in `app/build/outputs/apk/beta/release/`.
- Play: `./gradlew bundlePlayRelease`, AAB in `app/build/outputs/bundle/playRelease/`.
- Every beta APK must be signed with the same beta key and have a higher `versionCode` than the last one, or Android refuses the update.

The version and the upload key come from Gradle properties, never from the repo. Put them in `~/.gradle/gradle.properties` (outside the repo), or pass each as an environment variable named `ORG_GRADLE_PROJECT_<name>`, or as `-P<name>=...`.

| Property | Required for | Default |
|---|---|---|
| `emberVersionCode` | Every Play upload and beta APK; raise it each time | `3` |
| `emberVersionName` | The version users see | `0.9.0-beta.2` |
| `emberUploadStoreFile` | Release builds: path to the upload keystore (absolute, or relative to `mobile/android/app`) | none |
| `emberUploadStorePassword` | Release builds, unless `emberUploadStorePasswordFile` is set | none |
| `emberUploadStorePasswordFile` | Optional: a file (outside the repo, readable only by you) whose content is the store password, so it stays off the command line | none |
| `emberUploadKeyAlias` | Release builds | none |
| `emberUploadKeyPassword` | Release builds, unless `emberUploadStorePasswordFile` is set (then the key password is read from the same file) | none |

- Debug builds need none of them.
- `assembleBetaRelease`, `bundleBetaRelease`, `bundlePlayRelease`, `assembleRelease` or `bundleRelease` without the store file, alias and both passwords stops before building with "Release signing is not set up. Missing Gradle properties: ...". `assemblePlayRelease` builds an unsigned APK instead, for checks.
- Build the AAB for Play: `cd web && bun run build:mobile && bun run cap:sync`, then `cd mobile/android && ./gradlew bundlePlayRelease -PemberVersionCode=<n> -PemberVersionName=<x.y.z>`.
- Build the beta APK the same way with `./gradlew assembleBetaRelease -PemberUploadStoreFile=<beta keystore> -PemberUploadStorePasswordFile=<password file> -PemberUploadKeyAlias=<beta alias>`, then upload it so hosting rewrites `latest.json`.
- Create the upload key once with `keytool -genkeypair -keystore <path outside the repo> -alias upload -keyalg RSA -keysize 2048 -validity 10000`, then enrol in Play App Signing on the first upload.

## Changelog

Nothing released yet.
