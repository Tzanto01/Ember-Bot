# Ember legal texts (drafts)

> **Not legal advice.** These drafts are written from the code, not by a lawyer. Have them checked before anything is published. Nothing here is published yet, and nothing goes live until Nico approves it.

## Where the texts live

- **Source of truth:** `web/public/legal/`. The web app serves these files at `/legal/privacy`, `/legal/terms` and `/legal/imprint`. The Settings page links them, and the consent page links the privacy policy. Edit them only there.
- `docs/legal/*.md` are pointers only. They keep older links (for example in `mobile/STORE.md`) working. Do not copy the texts here.
- **Before the web build goes live:** the files are public once the web app is deployed. The inline `[PRÜFEN]` markers were removed on 2026-11-14. Every open point is a question below, listed by section under "Open points by section". Do not deploy until those questions are settled.

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

## Open points by section

The inline `[PRÜFEN]` markers are gone. Each open point is a question below. Find the section, then the question number.

| Section | Open point | Question |
|---|---|---|
| Privacy policy and Terms, top | Stand date on publish | 38 |
| Privacy policy, section 2 | Routine names not under consent | 12 |
| Privacy policy, section 3.2 | Routine names may hold health data | 12 |
| Privacy policy, section 3.5 | Device sign-in: legal basis, § 25 TDDDG, consent version | 15 |
| Privacy policy, section 3.5 | Android app before release, no Google push | 34 |
| Privacy policy, section 3.6 | IP addresses in access logs and proxy logs | 8 |
| Privacy policy, section 3.7 | Log retention period | 8 |
| Privacy policy, section 3.8 | Device settings under § 25 TDDDG | 15 |
| Privacy policy, sections 3.8 and 7 | Sessions and signup address on the device | 17 |
| Privacy policy, section 3.10 | Feedback text, screenshots, consent version, anonymous feedback | 23 |
| Privacy policy, section 3.12 | Reflections: consent coverage and version | 26 |
| Privacy policy, section 3.12 | DPIA for the moment flow | 27 |
| Privacy policy, section 4 | Routine names and habit renames under consent | 12 |
| Privacy policy, section 4 | Existing users and health data without consent | 2 |
| Privacy policy, section 4 | German text of the consent prompt | 1 |
| Privacy policy, section 4 | Consent version 2026-11 and the moment flow | 26 |
| Privacy policy, section 4 | Withdrawal without deleting the account | 3 |
| Privacy policy, section 5 | Routines, renames and push subscriptions | 12 |
| Privacy policy, section 6.1 | Discord as controller, EU entity, transfer basis | 5 |
| Privacy policy, section 6.2 | Cloudflare: DPF, DPA, start date | 6 |
| Privacy policy, section 6.3 | Resend: DPA, region, DPF, retention, tracking | 7 |
| Privacy policy, section 6.4 | Push services: transfers, own controllers | 33 |
| Privacy policy, section 7 | Backups and Proton Drive | 9 |
| Privacy policy, section 7 | Feedback digest emails in the mailbox | 23 |
| Privacy policy, section 9 | Export gaps (sessions, lockout, reminder entries) | 16 |
| Privacy policy, section 9 | Supervisory authority address and website | 35 |
| Privacy policy, section 10 | Minimum age, and minimum age for moments | 4, 28 |
| Terms and privacy policy, section 1 | "Privat und nicht kommerziell" next to the Kleinunternehmer line | 37 |
| Terms, section 2 | Android app named before release | 34 |
| Terms, section 3 | Minimum age 16 | 4 |
| Terms, section 6 | Wording: EU MDR, HWG, UWG | 24, 25, 32 |
| Terms, section 6 | Safety of exercise content | 30 |
| Terms, section 6 | Crisis numbers per country | 29 |
| Terms, section 9 | Notice period (now 30 days) | 14 |
| Impressum | Consumer dispute resolution sentence | 36 |
| Impressum | Kleinunternehmer line (§ 19 UStG) | 37 |

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
| Moment flow stores and sends nothing: no API call, no Local Storage, IndexedDB or query cache | Done by search of `web/src/components/moment`, `web/src/lib/moment` and `web/src/pages/moment.tsx` on `v2/companion-web`. Not yet run with the network off |
| Moment reflections need the private journal on, unlocked, and consent | Done (`reflect.tsx`, `appendPrivate` in `web/src/lib/journal/journal.ts`) |
| Turning off the private journal re-uploads moment notes as plain text | Done (copy in `journal-settings.tsx`) |
| Android moment widget holds no data | Done in commit `06d3890` (in `v2/companion-server`). Not yet on `v2/companion-web`. Recheck on merge |
| "Show streaks" setting, off for new accounts | Open. Web switch is uncommitted in the worktree (`settings.tsx`, `settings-groups.ts`) at drafting time. Server side is in commit `dd4a3a2` (`v2/companion-server`). Recheck on merge |
| Help right now: `/help` and the footer link | Done (`web/src/pages/help.tsx`, `legal-links.tsx`). The Settings group is uncommitted in the worktree (`settings-groups.ts`) at drafting time |
| Crisis lines `checked` date | Open. The field holds the compile date, 2026-11-13, which is not an official-source check (question 29) |

## Open questions

1. **Art. 9 consent basis and language.** The drafts rely on explicit consent (Art. 9(2)(a)) for habit names, check-ins, low days, day notes and moods. Get a ruling. The prompts are English ("I agree", "No thanks", web "One quick question", "Not now"). Decide whether German versions are needed.
2. **Existing users and "No thanks".** Check-ins on habits created before consent are not gated, and reminders keep running until the user answers. The bot pauses its prompt for 30 days after "No thanks". The web app asks again in the next session. Decide: may Ember keep processing existing health data without consent (the "decline-vs-processing" question)? Accept the text as written, stop processing until consent (code change), or time-box it?
3. **Withdrawal equals deletion.** The only way to withdraw consent is to delete the account. Accept this, or add a withdraw-only action?
4. **Minimum age.** The default in the texts is 16: Terms section 3, privacy section 10, and "Ember is for people 16 and older." on the signup and consent pages. Confirm it. Ember cannot verify age.
5. **Discord's role.** The drafts treat Discord as an independent controller. Check whether a joint-controllership argument applies to a bot, which Discord entity to name for EEA users, and the transfer basis (DPF or SCCs). Section 6.1 depends on this answer. Push services in section 6.4 are question 33.
6. **Cloudflare (before launch).** Accept Cloudflare's DPA in the Cloudflare dashboard before the public launch. At launch, confirm the Data Privacy Framework certification and the SCC fallback, and confirm section 6.2. Cloudflare ends TLS, so it can read request content.
7. **Resend.** Check the processing agreement (AVV) and its transfer basis (SCCs, DPF), the processing region chosen for ember-glow.app, Resend's retention period, and that click and open tracking are off for the domain. Otherwise links are rewritten and codes pass through a redirect. Section 6.3.
8. **Logs and retention.** Logs rotate by size only, with no time limit. Decide: add a cleanup that keeps the 30-day promise, or change section 3.7 to the period you choose. The same goes for reverse-proxy and Cloudflare access logs, which can hold IP addresses.
9. **Backups.** The repository defines no backup job. Confirm the cycle (the draft says daily, 7 days plus 4 weekly), where the off-site copy lives (Proton Drive is named), the encryption, and whether a cloud provider is involved (that would make it a processor). Publish only what actually runs.
10. **Backups after deletion.** Deleted accounts stay in backups until they rotate out. A restored backup brings them back. Decide whether a re-deletion process is needed, and how to do it without keeping a list of deleted Discord IDs.
11. **Inactive accounts.** Data stays until the user deletes it. Check whether storage limitation (Art. 5(1)(e)) requires an automatic deletion after long inactivity.
12. **Routines, habit renames and push subscriptions.** Not gated by consent. Routine names can say something about health. Decide: gate them (code change in routine create and edit, habit rename and push subscribe), or accept and justify it in the text. The text currently says they need no consent.
13. **DPIA and records of processing.** Health data may trigger a DPIA (Art. 35). A record of processing activities (Art. 30) is probably needed. Ask whether either is required for a private project of this size.
14. **Liability and term.** The liability clause is the standard German B2C wording. For a free service, §§ 521 and 599 BGB may already limit liability to intent and gross negligence. Check which wording is cleaner. The notice period in the Terms, section 9, is now 30 days. Confirm it.
15. **Legal basis of the consent record.** The draft names Art. 6(1)(c) with Art. 7(1). Check whether Art. 6(1)(f) fits better. Also decide whether the § 25 TDDDG basis for the device settings (theme, mode, reminder names) holds. Device registration of browsers and phones (installation ID, device label from the user agent, on/off) is new: confirm Art. 6(1)(b) as its basis and how § 25 TDDDG classifies the installation ID, and whether the consent version has to go up for it (privacy section 3.5).
16. **Export completeness (Art. 15).** Not in the export: the Discord reminder entries (channel, message, day), the failed sign-in count, the lockout end, and the sign-in sessions. Add them to the export (code change), or answer requests by hand? Section 9 says which applies today.
17. **Retention of sessions.** Expired sign-in sessions are deleted by the daily cleanup job, and an account keeps at most 50 sessions. The signup address is now removed on confirmation, on sign-out and after one day at the latest. Check the privacy text names both.
18. **Confirmation sign-in.** Resolved in code: after confirming a new account the web app signs in for the browser session only, without "Stay signed in" and without the offline copy.
19. **Public links.** Set `PRIVACY_POLICY_URL` in `.env` once the public address exists. The bot passes it as `Ember__PrivacyPolicyUrl` and derives the imprint link in `/help` from it. The Discord bot profile link is not in code and must be added by hand.
20. **Discord `/privacy delete` without password.** The bot's `/privacy delete` deletes an account after two clicks, even when the account has a password and two-factor sign-in. Accept this and say so in the policy, or require the web app for accounts with a password. (Security review H1, related.)
21. **Recovery codes stored unhashed.** Whoever can read the database can read the recovery codes and the authenticator secret. Accept and say so, or hash the recovery codes. The authenticator secret has to stay readable either way.
22. **Free service.** The terms say Ember is free. If a paid tier (Ember+, plan D5) is ever added, the terms and the policy must change first.
23. **Feedback (v1.13).** Feedback text, platform, app version, time and the account link (when signed in) are stored for 12 months and mailed once a day to the operator through Resend, without account ID or email address. Decide: (a) is the hint "don't include health details" enough under Art. 9, or is consent needed; (b) add feedback to the export (question 16) or answer requests by hand; (c) does the consent policy version (`2026-11`) need a bump for section 3.10; (d) delete the digest emails in the operator's mailbox after 12 months. Resend now also carries feedback text (question 7). **Pictures and anonymous feedback (v1.14):** a report also has a title, up to 5 pictures (signed in or from Discord, metadata stripped on the server) and an anonymous option that stores no account link. Pictures are kept until the operator marks the report handled plus 30 days, at most 12 months, and are not mailed (the digest names only their opaque ids). Decide: (e) is a hint enough for screenshots that can show health data or other people, or is consent needed; (f) is "handled plus 30 days, at most 12 months" an acceptable retention; (g) anonymous feedback can no longer be deleted with the account or found for an access request.
24. **EU MDR: intended purpose and claims.** Ember is written as a wellness tool, not a medical device. The moment flow (catch, name, ride it out, reflect) and the practice content are the parts most likely to be read as medical. Check the intended purpose in Terms sections 2 and 6 against Regulation (EU) 2017/745, and review every claim in the README, the release notes, the pitch and the store copy. Decide the final wording, and whether a classification assessment is needed before launch.
25. **HWG and UWG: health advertising.** The pitch ("A small campfire for big moments.", "A calm companion for hard moments and gentle days.") and the README talk about hard moments. Check them against the HWG (health claims, references to diseases) and the UWG (unproven claims). The README intro no longer names ADHD, autism or executive dysfunction, as the old one did. Confirm that is the safer line, and whether the store copy needs the same change.
26. **Art. 9 consent and moments.** Section 3.12 says a saved reflection becomes part of that day's note. The day-note consent (policy version `2026-11`) then covers it, and the flow itself needs no consent because it stores nothing. Get a ruling. Decide: does the current consent cover reflections, or is a separate notice or consent step needed? If the consent text changes, the version must go up and every user is asked again (section 4 of the policy).
27. **DPIA for moments.** The flow adds free text about hard moments, which can be health data. It is encrypted before it reaches the server when the private journal is on. Check whether the DPIA question in question 13 becomes mandatory, and whether that changes the answer.
28. **Minimum age for moments.** Question 4 sets the minimum age for consenting to health data. The moment flow is aimed at people in distress, so decide whether the same age applies, or whether a higher age or a note for parents is needed. Ember cannot verify age.
29. **Crisis numbers, per locale.** `web/src/content/crisis-lines.json` lists DE, AT, CH, GB, US, EU and INTL. The list now also has IE (Samaritans 116 123, emergency 999, plus the EU 112 row) and emergency rows for GB (999) and US (911). Its `checked` field says 2026-11-13, the day the list was compiled. The numbers, hours and links have not been checked against official sources. Before launch: check each one against the official source, set `checked` to the real check date, and set a recheck schedule (for example every six months and before each release). Decide the schedule and who owns it.
30. **Safety review of practice content.** `web/src/content/practices.json` holds six practices: breathing, a grounding exercise, a cool-water or cool-object step, a timed urge-surfing practice and two short reframes. Have a qualified person review each step for safety, including breathing steps, dizziness and cold water. Decide whether any warning is needed, and who signs off. The `basis` field is the public technique, kept for this review and never shown in the app.
31. **Play health-apps declaration and Data Safety form.** The Android app is an APK today, not a Google Play app (see the README). Before any Play release, answer Play's health apps declaration and the Data Safety form so they match section 3.12 of the policy and the store copy in `mobile/STORE.md`. Decide the answers with a lawyer before publishing.
32. **Terms disclaimer wording.** Section 6 of the terms says Ember is a wellness tool, not a medical device. It makes no diagnosis or treatment, does not replace professional help, asks people to call 112 in an emergency, and asks them to stop any exercise that does not feel right. Check the wording. Check also how the liability in section 10 and the rules for standard terms (§ 309 BGB) apply to free exercises.
33. **Push services (privacy section 6.4).** Web push goes through the push service of the user's browser: Google, Mozilla, Microsoft or Apple. Check whether these services transfer data to third countries, on what basis, and whether they act as their own controllers. Then update section 6.4.
34. **Android app before release (privacy section 3.5, Terms section 2).** The app is not published yet, so the Terms sentence that names it holds only from release. Before release, confirm that no Google push is active for Ember. The build includes the Google services plugin, but the app uses no Firebase messaging.
35. **Supervisory authority (privacy section 9).** Check the address and the website of the Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (www.ldi.nrw.de) before publishing.
36. **Consumer dispute resolution (Impressum).** The Impressum says the operator is not willing or obliged to take part in a consumer arbitration procedure. Confirm that sentence, or delete it.
37. **"Privat und nicht kommerziell" versus the Kleinunternehmer line.** Terms section 1 and privacy section 1 say Ember is run "privat und nicht kommerziell". The Impressum names the operator as Kleinunternehmer under § 19 UStG. Nico confirms which of the two is accurate; then align the other.
38. **Stand date on publish.** The Stand dates in the privacy policy and the Terms are 14 November 2026. Set both to the real publish date when the moments and streaks changes go live.

## What changed on 2026-11-13

Companion drafts, from `v2/companion-web` and `docs/contracts/companion-v1.md`:

- **Privacy policy:** new section 3.12 (moments), a line in the summary and in section 2, a moments row in section 5, the streak setting in the account settings row (3.1), and three storage rows that were missing from 3.8 (`ember.seenReleaseNotes`, `ember.tzClaimed.<account id>`, `ember.exactAlarmAsked`).
- **Terms:** section 2 (streaks are shown only when turned on, and the moment flow is named), section 6 (wellness tool, no diagnosis or treatment, call 112, stop any exercise that does not feel right, crisis numbers are not guaranteed).
- **Questions 24 to 32** added.
- **Release notes:** `0.9.0-beta.7` added with a placeholder date (2026-11-20). Not published.

## What changed on 2026-11-14

- Inline `[PRÜFEN]` markers removed from the three legal files. Each one's content moved to an existing question or to new questions 33 to 38. Questions 4, 5, 14 and 29 were updated.
- Stand dates set to 14 November 2026 (privacy policy and Terms). Question 38 covers the publish date.
- Beta wording in Terms section 5, the Terms summary and the privacy policy.
- Terms section 6: 112 (EU) or the local emergency number, a sentence that Ember does not help with thoughts of harming yourself, and a note to ask a doctor before breathing or cold exercises.
- Minimum age 16 (Terms section 3, privacy section 10) and notice period 30 days (Terms section 9). Questions 4 and 14 hold the decisions.
