# Ember legal texts (drafts)

> **Not legal advice.** These drafts are written from the code, not by a lawyer. Have them checked before anything is published. Nothing here is published yet, and nothing goes live until Nico approves it.

## Where the texts live

- **Source of truth:** `web/public/legal/`. The web app serves these files at `/legal/privacy`, `/legal/terms` and `/legal/imprint` and links them in its footer. Edit them only there.
- `docs/legal/*.md` are pointers only. They keep older links (for example in `mobile/STORE.md`) working. Do not copy the texts here.
- **Before the web build goes live:** the files are public once the web app is deployed. They still contain `[PRÜFEN: ...]` markers and the owner note in `impressum.md`. Do not deploy them as they are.

To list every open marker: `grep -n "PRÜFEN" web/public/legal/*.md`

## Status

Checked against the code at commit `b6b69e8` (API contract v1.8, reminders included). The texts describe the Discord bot, the web app, accounts, the optional private journal, web push, the Android app (not yet published) and the no-account mode.

## Decisions taken in these drafts

- **Operator:** Nico Pauly Wöllnitz, Erzbergerstraße 129, 46145 Oberhausen. Contact: contact@nicowoellnitz.de (also the support contact).
- **Impressum:** § 5 DDG only. Contact by email only, like the portfolio Impressum. No § 18 Abs. 2 MStV block, because Ember has no journalistic-editorial content.
- **Umsatzsteuer:** Kleinunternehmer under § 19 UStG, no USt-IdNr.
- **Hosting:** self-hosted in Germany at the operator's home. The public app is reached through a Cloudflare Tunnel on ember-glow.app, so Cloudflare, Inc. is a processor (section 6.2 of the privacy policy).
- **E-mail:** Brevo (Sendinblue SAS, France) today. Section 6.3 changes when the switch to a transactional provider (Resend or Postmark, not chosen) happens.
- **Discord:** the bot uses no privileged intents and reads no messages. "Sign in with Discord" asks only for the `identify` scope and stores only the Discord user ID.
- **Health data (Art. 9):** habit names, check-ins, low days, journal entries and moods, under consent (policy version `2026-10`).
- **Journal:** entries are plaintext on the server by default. The private journal is opt-in and end-to-end encrypted.
- **Android:** no Google/Firebase push. Reminders are local notifications.
- **Leaderboard:** removed in v1.6. The drafts no longer mention it.

## Placeholders

| Placeholder | Where | Status |
|---|---|---|
| `[PRÜFEN: Mindestalter ...]` | Datenschutzerklärung, section 10 | Open (question 4) |
| `[PRÜFEN: Frist festlegen ...]` | Nutzungsbedingungen, section 9 | Open (question 17) |
| Cloudflare processor section | Datenschutzerklärung, section 6.2 | Written. Confirm before launch (question 6) |

## Checks before publishing: code must match the texts

| Promise in the text | Status |
|---|---|
| Export (JSON or CSV) covers settings, consent record, habits, routines, check-ins, low days, day notes, moods, push endpoints, journal key | Done (`ExportBuilder.cs`, `GET /api/me/export`, bot `/export`) |
| Account deletion and `/privacy delete` delete everything at once | Done (cascade in `EmberDbContext.cs`; `DeleteUserDataAsync`) |
| Consent gates new habits, low days, day notes, moods, import and merge | Done. Check-ins for existing habits are not gated (question 2) |
| Web push goes only to Google, Mozilla, Microsoft and Apple push hosts | Done (`PushEndpoints.cs`) |
| No analytics, no ads, no external scripts or fonts | Done (no analytics SDK in `web/package.json`; fonts from `@fontsource`; no external URLs in the web source) |
| Habit names stay out of logs | Done for the bot and API log calls. Not reviewed line by line for every service |
| Logs deleted after 30 days | Open. Logs rotate by size only (3 x 10 MB per service, `docker-compose.yml`). Question 9 |
| Backups daily, kept 30 days | Open. No backup job is defined in this repository (`docs/v2-plan.md`, Phase 8.3). Question 10 |
| Policy link in the consent prompt | Partly. `docker-compose.yml` passes `Ember__PrivacyPolicyUrl` from `PRIVACY_POLICY_URL`. The value must be set (question 20) |
| Impressum link in `/help` and the bot profile | Open. Question 20 |
| Android app sends no Google push | Verified for now (no Firebase messaging dependency; the Google services plugin applies only with `google-services.json`). Recheck before release |
| Recovery codes stored hashed | Open. Not confirmed from the code |
| Unconfirmed accounts are deleted | Open. Nothing deletes them automatically (question 12) |

## Open questions

1. **Art. 9 consent basis.** The drafts rely on explicit consent (Art. 9(2)(a)) for habit names, check-ins, low days, day notes and moods. Get a ruling. The prompt texts are English ("I agree", "No thanks", the web page "One quick question"). Decide whether German versions are needed.
2. **Existing users.** Check-ins for habits created before the consent step are not gated, and reminders keep running until the user answers. Accept this, or time-box it (for example: pause check-ins after N days without consent)?
3. **Withdrawal equals deletion.** The only way to withdraw consent is to delete the account. Accept this, or add a withdraw-only action?
4. **Minimum age.** Set `[PRÜFEN: Mindestalter]` (suggestion 16). Ember cannot verify age.
5. **Discord's role.** The drafts treat Discord as an independent controller. Check whether a joint-controllership argument applies to a bot, which Discord entity to name for EEA users, and the transfer basis (DPF or SCCs). Fill the `[PRÜFEN]` markers in section 6.1.
6. **Cloudflare (before launch).** Accept Cloudflare's DPA in the Cloudflare dashboard before the public launch. At launch, confirm the Data Privacy Framework certification and the SCC fallback, and confirm the section 6.2 text. Note that Cloudflare ends TLS, so it can read request content.
7. **Second contact channel.** Decided (2026-11-11): phone number in the Impressum only, as on the portfolio. Legal pages are sent with `X-Robots-Tag: noindex`.
8. **E-mail provider.** Brevo is named today. Check the processing agreement (AVV) and Brevo's retention period. When the switch to Resend or Postmark happens, change section 6.3 and check the new provider's agreement.
9. **Logs and retention.** Logs rotate by size only, with no time limit. Decide: add a 30-day cleanup and keep the promise, or change section 3.7. The same goes for access logs of the reverse proxy and Cloudflare, which can hold IP addresses.
10. **Backups.** The repository defines no backup job. Confirm the cycle (the draft says 30 days), where the off-site copy lives, the encryption, and whether a cloud provider is involved (that would make it a processor). Publish only what actually runs.
11. **Backups after deletion.** Deleted accounts stay in backups until they rotate out. A restored backup brings them back. Decide whether a re-deletion process is needed, and how to do it without keeping a list of deleted Discord IDs.
12. **Unconfirmed accounts.** Accounts whose email was never confirmed stay until someone confirms or deletes them. Decide on an automatic deletion period, or accept.
13. **Inactive accounts.** Data stays until the user deletes it. Check whether storage limitation (Art. 5(1)(e)) requires an automatic deletion after long inactivity.
14. **Routine names.** Routine writes need no consent, and routine names can say something about health. Decide: gate routines like habits (code change), or accept. Habit renaming is also not gated.
15. **Consent text and policy version.** The consent prompts (bot and web) name only habits, check-ins and low days. They do not name journal entries and moods, although those writes are gated too. Change the text (code change). Also decide whether the expanded policy needs a new version: bumping `CurrentConsentPolicyVersion` asks every user again.
16. **DPIA and records of processing.** Health data may trigger a DPIA (Art. 35). A record of processing activities (Art. 30) is probably needed. Ask whether either is required for a private project of this size.
17. **Liability and term.** The liability clause is the standard German B2C wording. For a free service, §§ 521 and 599 BGB may already limit liability to intent and gross negligence. Check which wording is cleaner. Also set the notice period in section 9 (`[PRÜFEN: Frist festlegen]`).
18. **Du or Sie.** The texts use "du" to match Ember's tone. Confirm.
19. **Legal basis of the consent record.** The draft names Art. 6(1)(c) with Art. 7(1). Check whether Art. 6(1)(f) fits better.
20. **Public links.** Set `PRIVACY_POLICY_URL` in `.env` once the public address exists (the bot passes it as `Ember__PrivacyPolicyUrl`). Add links to the Impressum and the policy in `/help` and the bot profile. Both are missing.
21. **Free service.** The terms say Ember is free. If a paid tier (Ember+, plan D5) is ever added, the terms and the policy must change first.
22. **Impressum note.** Delete the owner note in `impressum.md` and the `[PRÜFEN]` markers before publishing.
