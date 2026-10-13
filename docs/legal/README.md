# Ember legal texts (drafts)

> **Not legal advice.** These are drafts written from the code, not by a lawyer. Have them checked (a lawyer, or at least a reputable generator such as the ones from e-recht24 or Dr. Schwenke as a cross-check) before anything is published. Nothing here is published yet.

The German texts are binding. Each file starts with a short English summary.

| File | What it is |
|---|---|
| `datenschutzerklaerung.md` | Privacy policy (GDPR Art. 13) |
| `nutzungsbedingungen.md` | Terms of use |
| `impressum.md` | Legal notice (§ 5 DDG, § 18 MStV), with a note on when it is required (delete the note before publishing) |

The texts describe Ember as of Phase 3 (branch `v2/phase-3-backfill`): `/export` (CSV or JSON, full data), `/privacy delete`, stored `NextReminderUtc`, DM failure counter and pause, backfill through `/habit history`, low days, the pause start date, and the Art. 9 consent flow with its consent record. See "Before publishing" below.

The consent record carries a policy version (`HabitService.CurrentConsentPolicyVersion`, currently `2026-10`). Changing it asks every user for consent again, so bump it only when the policy changes in a way that needs new consent.

## Placeholders to fill

| Placeholder | Files |
|---|---|
| `[NAME]` | all three |
| `[ANSCHRIFT: ...]` (street, postcode, city; must be a serviceable address, no PO box) | Datenschutzerklärung, Impressum |
| `[E-MAIL]` | all three |
| `[ZWEITER SCHNELLER KONTAKTWEG]` (optional) | Impressum |
| `[DATUM]` (Stand) | Datenschutzerklärung, Nutzungsbedingungen |
| ~~`[LOG-AUFBEWAHRUNG IN TAGEN]`~~ set to 30 days (common default for operational logs) | Datenschutzerklärung (3.3 and 7) |
| ~~`[BACKUP-RHYTHMUS]`, `[BACKUP-AUFBEWAHRUNG IN TAGEN]`~~ set to daily, 30 days | Datenschutzerklärung (7) |
| `[NAME/ANSCHRIFT/WEBSITE DER AUFSICHTSBEHÖRDE]` (data protection authority of your Bundesland) | Datenschutzerklärung (9) |
| `[MINDESTALTER]` | Datenschutzerklärung (10) |
| `[VPS-ANBIETER, Sitz]`, `[LAND IN DER EU]` (the whole bracketed paragraph replaces the homeserver paragraph after the move) | Datenschutzerklärung (6.2) |
| `[ZU PRÜFEN: ...]` Discord's EEA controller entity and transfer basis | Datenschutzerklärung (6.1) |
| `[FRIST]` (notice period before shutting Ember down) | Nutzungsbedingungen (7) |
| `[NUR AUFNEHMEN, FALLS ...]` § 18 Abs. 2 MStV block, `[OPTIONAL]` dispute resolution line | Impressum |

## Open legal questions

1. **Art. 9 consent basis.** The policy relies on explicit consent (Art. 9(2)(a)) for habit names, check-ins and low days. The consent step is now built: new users agree before their first habit or low day, and Ember stores the time and policy version. Is consent the right basis, or does Art. 6(1)(b) plus "data is not health data by default" hold? Get a ruling. The prompt itself is in English ("I agree" / "No thanks"); check whether a German-language prompt is needed for German users.
   - **1a. Existing users during the prompt period.** Users who had data before the consent step keep it working (check-ins, reminder buttons, reminders) until they answer, and are asked at most once a day. That means Ember keeps processing, and even collects new, possibly health-related check-ins, without Art. 9 consent during that period. The same applies after they pick "No thanks": their existing data stays and keeps working until they decide. Is that acceptable, or should it be time-boxed (for example: after N days without consent, pause reminders and check-ins, or delete the data after a notice)?
   - **1b. Low days on share cards.** A low day is user-wide and health-adjacent. `/habit share` posts the last 30 days with low days shown as 🌙 (`HabitSelectModule.cs:201`). The user posts it themselves, but they may not realize a moon reveals a low day. Decide whether that's fine or whether the card should show low days as plain gaps (then update section 4 of the policy).
2. **Withdrawal = deletion.** The draft treats `/privacy delete` as the way to withdraw Art. 9 consent. Check that this is acceptable, or whether a separate "withdraw consent" action is needed.
3. **Minimum age.** Discord's own minimum age varies by country. Under Art. 8 GDPR and German law, consent from under-16s needs parental consent. Does that apply to Art. 9 explicit consent here, and what age should `[MINDESTALTER]` be? Ember cannot verify age.
4. **Discord's role.** The draft calls Discord an independent controller, not a processor. Check whether a joint-controllership argument (like the Facebook fan page rulings, C-210/16 and C-40/17) applies to a bot, and which Discord entity to name for EEA users.
5. **Discord's third-country transfer basis.** Confirm from Discord's current privacy policy (DPF certification, SCCs) and fill `[ZU PRÜFEN]`.
6. **AVV/DPA with the VPS provider.** After the move (N7, Phase 8) the provider is a processor under Art. 28, so an AVV is needed (Hetzner offers one). Today on the homeserver no processor is involved, as long as no external backup or monitoring service sees the data. Confirm.
7. **Backups after deletion.** Deleted users stay in backups until rotation. If a backup is restored, already-deleted users come back. Decide whether a process is needed (and how to do it without keeping a list of deleted Discord IDs).
8. **Inactive accounts.** Data stays until the user deletes it; there is no automatic deletion after long inactivity. Check whether storage limitation (Art. 5(1)(e)) requires one.
9. **DPIA and records of processing.** Health data may trigger a DPIA (Art. 35), depending on scale. A record of processing activities (Art. 30) is probably needed because the processing is not occasional. Ask whether either is required for a private project of this size.
10. **Impressum.** Whether § 5 DDG and § 18 MStV apply, and whether a c/o address is enough (see the note in `impressum.md`).
11. **Liability clause.** The draft uses the standard German B2C clause. For a free service, §§ 521, 599 BGB may already limit liability to intent and gross negligence; check which wording is cleaner.
12. **Du vs. Sie.** The texts use "du" to match Ember's tone. Fine for consumer texts, but confirm.
13. **Where the texts live.** They need a public URL (for the bot profile, `/help` and later the app stores). Once the policy is published, set the config value `Ember:PrivacyPolicyUrl` (environment variable `Ember__PrivacyPolicyUrl`): the consent prompt links to the policy only when it is set. `docker-compose.yml` passes only the variables it lists, so the variable must also be added to its `environment:` block.
14. **Consent record legal basis.** The draft names Art. 6(1)(c) with Art. 7(1) for keeping the consent record. Check whether that, or Art. 6(1)(f), is the better fit.

## Before publishing: code must match the texts

Each promise in the drafts must be true before publishing. Status against `v2/phase-3-backfill`:

| Promise in the text | Status |
|---|---|
| "Habit-Namen gehören nicht in die Protokolle" (3.3) | Done in code: no log statement includes a habit name. Log lines written by older builds must still age out or be deleted. |
| Logs deleted after 30 days | Open. Homeserver: size-based rotation only (3 x 10 MB, `docker-compose.yml`), no hard time limit. Enforce 30 days with time-based retention on the VPS (Phase 8). |
| `/export` gives CSV or JSON with settings, consent record, all habits, logs with server ID and low days (9) | Done (`ExportModule.cs`, `ExportBuilder.cs`). |
| `/privacy delete` deletes everything immediately (7, 9) | Done. Deleting the user row cascades to habits, logs and day marks (`EmberDbContext.cs`). |
| Consent before the first habit or low day, existing users asked at most once a day, new version asks again (4) | Done (`ConsentModule.cs`, `ConsentPromptNotifier.cs`, `HabitService.CurrentConsentPolicyVersion`). See open questions 1 to 1b. |
| DM failure counter and reminder pause (3.1) | Done (`ReminderDispatchJob.cs`, `DmRetryModule.cs`). |
| "Ember legt einen Eintrag erst an, wenn du eine Funktion nutzt, die etwas speichern muss" (3.1) | True, with one quirk: `/privacy optout` also creates a user row (`SetLeaderboardOptInAsync` calls `EnsureUserAsync`) even for someone who was never opted in. Harmless, but avoidable. |
| Backup daily, 30 days rotation (7) | Open. No backup is defined in this repository. Phase 8.3 plans nightly encrypted `pg_dump`. Publish only what actually runs. |
| Link to the policy in the consent prompt, `/help` and the bot profile | Open. The prompt link needs `Ember__PrivacyPolicyUrl` (open question 13). `/help` has no link yet. |
