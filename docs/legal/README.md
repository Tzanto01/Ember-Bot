# Ember legal texts (drafts)

> **Not legal advice.** These drafts are written from the code, not by a lawyer. Have them checked before anything is published. Nothing here is published yet, and nothing goes live until Nico approves it.

## Where the texts live

- **Source of truth:** `web/public/legal/`. The web app serves these files at `/legal/privacy`, `/legal/terms` and `/legal/imprint`. The Settings page links them, and the consent page links the privacy policy. Edit them only there.
- `docs/legal/*.md` are pointers only. They keep older links (for example in `mobile/STORE.md`) working. Do not copy the texts here.
- **Before the web build goes live:** the files are public once the web app is deployed. They still contain `[PRÜFEN: ...]` markers. Do not deploy them as they are.

To list every open marker: `grep -n "PRÜFEN" web/public/legal/*.md`

## Status

Checked against the code on 2026-11-11. The texts describe the state after the current fix round. That round is on these branches and is not merged yet:

- `v2/fix-bot` (e566a28)
- `v2/fix-api` (2fa0bb5)
- `v2/fix-account` (e174b63)
- `v2/fix-platform` (7985184)
- `v2/fix-mobile` (8241bfc)

Base: `v2/features-1` at 74daedb. Re-check the claims after the merge.

The texts describe the Discord bot, the web app, accounts, the optional private journal, web push, the Android app (not yet published) and the no-account mode. API contract v1.8.

## What changed on 2026-11-11

Security review: `REPORT.md`, section "Legal text vs code mismatches" (items 1 to 13) and findings H1, H2, M1, M2, L8 and L9.

| # | Mismatch | Status in the drafts |
|---|---|---|
| 1 | Discord `/export` held journal text and moods | Text fixed. Code on `v2/fix-bot` (Discord export limited to settings, habits, logs, day marks and routines) |
| 2 | Consent prompt and policy version | Text fixed. Code on `v2/fix-bot` and `v2/fix-account` (prompt names day notes and moods, version `2026-11`, "No thanks" pauses the bot prompt for 30 days) |
| 3 | Legal pages not `noindex` | Imprint note moved here. Code on `v2/fix-api` |
| 4 | Discord sign-in persistence | Text fixed: always 14 days |
| 5 | Discord scope wording | Text fixed: Ember keeps only the Discord user ID |
| 6 | Routines, renames and push subscriptions not gated | Described honestly in sections 2, 4 and 5. Decision open (question 12) |
| 7 | Export misses reminder entries and lockout state | Gap stated in section 9 with `[PRÜFEN]`. Open (question 16) |
| 8 | Check-ins "mit Zeitangaben" | Text fixed: date only |
| 9 | Data lists incomplete | Added: failed sign-in count and lockout end, sign-in sessions, creation times of moods, push subscriptions and the account, Discord reminder entries |
| 10 | Logs described too narrowly | Added: Discord user IDs, push subscription IDs, stack traces |
| 11 | Deletion and other devices | Added: local copies stay on other devices until they reach the server. Discord reminder buttons stay after deletion |
| 12 | Logout | Text describes per-device logout and "Sign out everywhere". Code on `v2/fix-api` with tests in `SessionTests.cs` |
| 13 | Resend, backups, Proton Drive, Cloudflare DPA | Not in the repository. Markers kept |

Also changed:

- **Storage table** (privacy policy 3.8): all new device keys, IndexedDB stores and Android storage, with what each holds and when it goes.
- **Labels:** menu names now match the app's English labels ("Your data", "Delete your account", "Unlink Discord", "Stay signed in", "Export backup").
- **Terms** (`nutzungsbedingungen.md`): export and deletion paragraphs describe the Discord and web export split.
- **Impressum:** owner note removed. Its content is in "Decisions" below.

## Decisions taken in these drafts

- **Operator:** Nico Pauly Wöllnitz, Erzbergerstraße 129, 46145 Oberhausen. Contact: contact@nicowoellnitz.de (also the support contact). The name and address come from the earlier drafts and are not checked against any repository file. The owner confirms them.
- **Impressum:** § 5 DDG only. Why an Impressum at all: Ember is public and also a portfolio project. § 5 DDG applies to business-like digital services, courts read that broadly, and no money has to flow. So an Impressum is the safe choice.
- **Impressum contact:** email, and the phone number only in the Impressum (decided 2026-11-11, as on the portfolio).
- **No § 18 Abs. 2 MStV block**, because Ember has no journalistic-editorial content.
- **Postal address:** the home address is the address for legal service. A PO box is not enough.
- **Where the Impressum must be:** easy to find and always reachable. In the web app the Settings page lists Privacy, Terms and Imprint. The Discord bot's `/help` shows the privacy and imprint links when `PRIVACY_POLICY_URL` is set. The Discord bot profile has no link yet (question 19).
- **Search engines:** the server sends `X-Robots-Tag: noindex` on `/legal/*`, so a search for the name does not show the address.
- **Umsatzsteuer:** Kleinunternehmer under § 19 UStG, no USt-IdNr.
- **Hosting:** self-hosted in Germany at the operator's home. The public app is reached through a Cloudflare Tunnel on ember-glow.app, so Cloudflare, Inc. is a processor (section 6.2 of the privacy policy).
- **E-mail:** Resend (Resend, Inc., USA) since 2026-11-11, section 6.3. Brevo before.
- **Discord:** the bot uses no privileged intents and reads no messages. "Sign in with Discord" asks for the `identify` scope. Ember keeps only the Discord user ID. The Discord sign-in lasts 14 days.
- **Sessions:** every sign-in gets a server-side session (14 days, sliding). Logout ends this device only. "Sign out everywhere" ends all of them. A password reset, a change to two-factor sign-in, linking or unlinking Discord and an account merge end the other sessions.
- **Health data (Art. 9):** habit names, check-ins, low days, day notes and moods, under consent (policy version `2026-11`). Routines, habit renames and push subscriptions are not gated (question 12).
- **Journal:** entries are plaintext on the server by default. The private journal is opt-in and end-to-end encrypted.
- **Android:** no Google/Firebase push. Reminders are local notifications, planned up to 14 days ahead.
- **Leaderboard:** removed in v1.6. The drafts no longer mention it.

## Placeholders

The markers are inline. Each category has a question below.

| Marker | Where | Question |
|---|---|---|
| Mindestalter | Privacy policy, section 10 | 4 |
| Frist festlegen | Terms, section 9 | 14 (notice period) |
| Routinen und Umbenennen unter Einwilligung | Privacy policy, sections 2, 4 and 5 | 12 |
| Bestehende Gesundheitsdaten ohne Einwilligung | Privacy policy, section 4 | 2 |
| Deutsche Fassung der Abfrage | Privacy policy, section 4 | 1 |
| Logs, IP-Adressen | Privacy policy, sections 3.6 and 3.7 | 8 |
| Backups, Proton Drive | Privacy policy, section 7 | 9 |
| Sitzungen und Signup-Adresse auf dem Gerät | Privacy policy, sections 3.8 and 7 | 17 |
| Export-Lücken | Privacy policy, section 9 | 16 |
| Resend, Tracking | Privacy policy, section 6.3 | 7 |
| Feedback: Gesundheitsangaben, Export, Einwilligungsversion | Privacy policy, section 3.10 | 23 |
| Feedback-E-Mails im Postfach | Privacy policy, section 7 | 23 |
| Cloudflare | Privacy policy, section 6.2 | 6 |
| Discord als Verantwortlicher, Drittlandübermittlung | Privacy policy, section 6.1 and 6.4 | 5 |
| Android-Push | Privacy policy, section 3.5 | (check before release) |
| Widerruf ohne Kontolöschung | Privacy policy, section 4 | 3 |
| Einstufung nach § 25 TDDDG | Privacy policy, section 3.8 | 15 |
| Aufsichtsbehörde | Privacy policy, section 9 | (check address) |
| Verbraucherstreitbeilegung | Impressum | (confirm or delete) |

## Checks before publishing: code must match the texts

| Promise in the text | Status |
|---|---|
| Export (JSON or CSV) on the web covers everything listed in section 9 | Done on `v2/features-1` (`ExportBuilder.BuildDocument`, `GET /api/me/export`). Gaps: sign-in sessions, attempt count, lockout end, Discord reminder entries (question 16) |
| Discord `/export` shows only settings, habits, check-ins, day marks and routines | Done on `v2/fix-bot` (`ExportBuilder.BuildDocument(forDiscord)`) |
| Account deletion and `/privacy delete` delete everything at once | Done on the server (cascade for every table, including `AuthSessions`; `DeleteUserDataAsync`). Other devices keep local copies until they reach the server (section 9) |
| Consent gates new habits, low days, day notes, moods, import and merge | Done (`HabitService`; journal, low-day, import and merge endpoints). Not gated: check-ins on existing habits, routines, habit renames, push subscriptions (question 12) |
| Consent prompt names habits, check-ins, low days, day notes and moods; policy version `2026-11` | Done on `v2/fix-bot` (bot prompt) and `v2/fix-account` (web page). The prompt texts are English (question 1) |
| "No thanks" pauses the bot prompt for 30 days | Done on `v2/fix-bot` (`ConsentDeclineBackoffDays`). The web app has no such pause; it asks once per session |
| Web push goes only to Google, Mozilla, Microsoft and Apple push hosts | Done (`PushEndpoints.cs`). Not checked again in this round |
| No analytics, no ads, no external scripts or fonts | Done. Fonts are self-hosted and precached (`v2/fix-platform`) |
| Habit names stay out of logs | Done for the bot and API log calls. Logs do contain Discord user IDs, push subscription IDs and stack traces (section 3.7). Checked by search, not line by line for every service |
| Logs deleted after 30 days | Open. Logs rotate by size only (3 x 10 MB per service, `docker-compose.yml`). Question 8 |
| Backups daily, kept 30 days | Open. No backup job is defined in this repository (`docs/v2-plan.md`, Phase 8.3). Question 9 |
| Policy link in the consent prompt | Partly. `docker-compose.yml` passes `Ember__PrivacyPolicyUrl` from `PRIVACY_POLICY_URL`. The value must be set (question 19) |
| Imprint link in `/help` | Done on `v2/fix-bot`, when the privacy URL ends with `/legal/privacy` (the imprint URL is derived from it). The bot profile link is open (question 19) |
| Android app sends no Google push | Verified for now. No Firebase messaging dependency; the Google services plugin applies only with `google-services.json`. Recheck before release |
| Recovery codes stored hashed | Not true. Stored unhashed in the Identity token table (security review L3). The text does not claim hashing. Question 21 |
| Unconfirmed accounts are deleted after 7 days | Done (`DeleteStaleUnconfirmedAccountsAsync`, daily `UnconfirmedAccountCleanupJob`). Only accounts that have no data and no Discord login |
| Sessions end as described (logout, sign out everywhere, reset, 2FA, merge) | Done on `v2/fix-api` (`SessionTests.cs`). Expired sessions are purged only at the next sign-in (question 17) |
| Signup address is kept on the device only until confirmation | Done on `v2/fix-account` (`ember.signupEmail`). Not cleared if the account is never confirmed (question 17) |
| Offline copy of the account and habits only with "Stay signed in" | Done on `v2/fix-platform` (`ember.offlineMe`, IndexedDB `cache`). Confirmation signs the user in with "Stay signed in" on (question 18) |
| Mail tracking off at Resend; Resend agreement; Proton Drive; Cloudflare DPA | Not in the repository. Check by hand (questions 6, 7, 9) |

## Open questions

1. **Art. 9 consent basis and language.** The drafts rely on explicit consent (Art. 9(2)(a)) for habit names, check-ins, low days, day notes and moods. Get a ruling. The prompts are English ("I agree", "No thanks", web "One quick question", "Not now"). Decide whether German versions are needed.
2. **Existing users and "No thanks".** Check-ins on habits created before consent are not gated, and reminders keep running until the user answers. The bot pauses its prompt for 30 days after "No thanks". The web app asks again in the next session. Decide: may Ember keep processing existing health data without consent (the "decline-vs-processing" question)? Accept the text as written, stop processing until consent (code change), or time-box it?
3. **Withdrawal equals deletion.** The only way to withdraw consent is to delete the account. Accept this, or add a withdraw-only action?
4. **Minimum age.** Set `[PRÜFEN: Mindestalter]` (suggestion 16). Ember cannot verify age.
5. **Discord's role.** The drafts treat Discord as an independent controller. Check whether a joint-controllership argument applies to a bot, which Discord entity to name for EEA users, and the transfer basis (DPF or SCCs). Fill the `[PRÜFEN]` markers in sections 6.1 and 6.4.
6. **Cloudflare (before launch).** Accept Cloudflare's DPA in the Cloudflare dashboard before the public launch. At launch, confirm the Data Privacy Framework certification and the SCC fallback, and confirm section 6.2. Cloudflare ends TLS, so it can read request content.
7. **Resend.** Check the processing agreement (AVV) and its transfer basis (SCCs, DPF), the processing region chosen for ember-glow.app, Resend's retention period, and that click and open tracking are off for the domain. Otherwise links are rewritten and codes pass through a redirect. Section 6.3.
8. **Logs and retention.** Logs rotate by size only, with no time limit. Decide: add a cleanup that keeps the 30-day promise, or change section 3.7 to the period you choose. The same goes for reverse-proxy and Cloudflare access logs, which can hold IP addresses.
9. **Backups.** The repository defines no backup job. Confirm the cycle (the draft says daily, 7 days plus 4 weekly), where the off-site copy lives (Proton Drive is named), the encryption, and whether a cloud provider is involved (that would make it a processor). Publish only what actually runs.
10. **Backups after deletion.** Deleted accounts stay in backups until they rotate out. A restored backup brings them back. Decide whether a re-deletion process is needed, and how to do it without keeping a list of deleted Discord IDs.
11. **Inactive accounts.** Data stays until the user deletes it. Check whether storage limitation (Art. 5(1)(e)) requires an automatic deletion after long inactivity.
12. **Routines, habit renames and push subscriptions.** Not gated by consent. Routine names can say something about health. Decide: gate them (code change in routine create and edit, habit rename and push subscribe), or accept and justify it in the text. The text currently says they need no consent and marks that.
13. **DPIA and records of processing.** Health data may trigger a DPIA (Art. 35). A record of processing activities (Art. 30) is probably needed. Ask whether either is required for a private project of this size.
14. **Liability and term.** The liability clause is the standard German B2C wording. For a free service, §§ 521 and 599 BGB may already limit liability to intent and gross negligence. Check which wording is cleaner. Also set the notice period in the Terms, section 9.
15. **Legal basis of the consent record.** The draft names Art. 6(1)(c) with Art. 7(1). Check whether Art. 6(1)(f) fits better. Also decide whether the § 25 TDDDG basis for the device settings (theme, mode, reminder names) holds.
16. **Export completeness (Art. 15).** Not in the export: the Discord reminder entries (channel, message, day), the failed sign-in count, the lockout end, and the sign-in sessions. Add them to the export (code change), or answer requests by hand? Section 9 says which applies today.
17. **Retention of sessions.** Expired sign-in sessions are deleted by the daily cleanup job, and an account keeps at most 50 sessions. The signup address is now removed on confirmation, on sign-out and after one day at the latest. Check the privacy text names both.
18. **Confirmation sign-in.** Resolved in code: after confirming a new account the web app signs in for the browser session only, without "Stay signed in" and without the offline copy.
19. **Public links.** Set `PRIVACY_POLICY_URL` in `.env` once the public address exists. The bot passes it as `Ember__PrivacyPolicyUrl` and derives the imprint link in `/help` from it. The Discord bot profile link is not in code and must be added by hand.
20. **Discord `/privacy delete` without password.** The bot's `/privacy delete` deletes an account after two clicks, even when the account has a password and two-factor sign-in. Accept this and say so in the policy, or require the web app for accounts with a password. (Security review H1, related.)
21. **Recovery codes stored unhashed.** Whoever can read the database can read the recovery codes and the authenticator secret. Accept and say so, or hash the recovery codes. The authenticator secret has to stay readable either way.
22. **Free service.** The terms say Ember is free. If a paid tier (Ember+, plan D5) is ever added, the terms and the policy must change first.
23. **Feedback (v1.13).** Feedback text, platform, app version, time and the account link (when signed in) are stored for 12 months and mailed once a day to the operator through Resend, without account ID or email address. Decide: (a) is the hint "don't include health details" enough under Art. 9, or is consent needed; (b) add feedback to the export (question 16) or answer requests by hand; (c) does the consent policy version (`2026-11`) need a bump for section 3.10; (d) delete the digest emails in the operator's mailbox after 12 months. Resend now also carries feedback text (question 7). **Pictures and anonymous feedback (v1.14):** a report also has a title, up to 5 pictures (signed in or from Discord, metadata stripped on the server) and an anonymous option that stores no account link. Pictures are kept until the operator marks the report handled plus 30 days, at most 12 months, and are not mailed (the digest names only their count). Decide: (e) is a hint enough for screenshots that can show health data or other people, or is consent needed; (f) is "handled plus 30 days, at most 12 months" an acceptable retention; (g) anonymous feedback can no longer be deleted with the account or found for an access request.
