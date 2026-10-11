# Ember legal texts (drafts)

> **Not legal advice.** These are drafts written from the code, not by a lawyer. Have them checked (a lawyer, or at least a reputable generator such as the ones from e-recht24 or Dr. Schwenke as a cross-check) before anything is published. Nothing here is published yet.

The German texts are binding. Each file starts with a short English summary.

| File | What it is |
|---|---|
| `datenschutzerklaerung.md` | Privacy policy (GDPR Art. 13) |
| `nutzungsbedingungen.md` | Terms of use |
| `impressum.md` | Legal notice (§ 5 DDG, § 18 MStV), with a note on when it is required (delete the note before publishing) |

The texts describe Ember **after Phase 2 lands**: `/export` (CSV or JSON, full data), `/privacy delete`, stored `NextReminderUtc`, DM failure counter and pause, and no habit names in logs. See "Before publishing" below.

## Placeholders to fill

| Placeholder | Files |
|---|---|
| `[NAME]` | all three |
| `[ANSCHRIFT: ...]` (street, postcode, city; must be a serviceable address, no PO box) | Datenschutzerklärung, Impressum |
| `[E-MAIL]` | all three |
| `[ZWEITER SCHNELLER KONTAKTWEG]` (optional) | Impressum |
| `[DATUM]` (Stand) | Datenschutzerklärung, Nutzungsbedingungen |
| `[LOG-AUFBEWAHRUNG IN TAGEN]` | Datenschutzerklärung (3.3 and 7) |
| `[BACKUP-RHYTHMUS]`, `[BACKUP-AUFBEWAHRUNG IN TAGEN]` | Datenschutzerklärung (7) |
| `[NAME/ANSCHRIFT/WEBSITE DER AUFSICHTSBEHÖRDE]` (data protection authority of your Bundesland) | Datenschutzerklärung (9) |
| `[MINDESTALTER]` | Datenschutzerklärung (10) |
| `[VPS-ANBIETER, Sitz]`, `[LAND IN DER EU]` (the whole bracketed paragraph replaces the homeserver paragraph after the move) | Datenschutzerklärung (6.2) |
| `[ZU PRÜFEN: ...]` Discord's EEA controller entity and transfer basis | Datenschutzerklärung (6.1) |
| `[FRIST]` (notice period before shutting Ember down) | Nutzungsbedingungen (7) |
| `[NUR AUFNEHMEN, FALLS ...]` § 18 Abs. 2 MStV block, `[OPTIONAL]` dispute resolution line | Impressum |

## Open legal questions

1. **Art. 9 consent mechanism.** The privacy policy relies on explicit consent (Art. 9(2)(a)) for habit names and check-ins. Today Ember has **no consent step**. That implies a product change: a one-time consent screen (button "Ich stimme zu", with a link to the policy) before the first habit is created, a stored consent timestamp and policy version, and a way to ask **existing users** for consent (or pause their data) before the policy goes live. Is consent the right basis, or does Art. 6(1)(b) plus "data is not health data by default" hold? Get a ruling.
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
13. **Where the texts live.** They need a public URL (for the bot profile, `/help` and later the app stores).

## Before publishing: code must match the texts

The drafts promise things the code on `main` does not do yet. Each one must be true before publishing.

| Promise in the text | Current code (`main` @ 464b2e8) |
|---|---|
| "Habit-Namen gehören nicht in die Protokolle" (3.3) | `ReminderJob.cs:45` and `ReminderScheduler.cs:34-36` log the habit name at Information level. Phase 2.5 removes this; old log lines must also be rotated out or deleted. |
| Logs deleted after `[LOG-AUFBEWAHRUNG]` days | No log rotation configured. The container logs to stdout (`docker-compose.yml` has no `logging:` options), so Docker's default `json-file` driver keeps them until the container is removed. Add `max-size`/`max-file` or an equivalent. |
| `/export` gives CSV or JSON with settings, all habits and logs incl. server ID (9) | Today the command is `/export habits`, CSV only, no settings, no habits without logs, no `GuildId` (`ExportModule.cs:18-49`). Phase 2.2. |
| `/privacy delete` deletes everything immediately (7, 9) | Not implemented yet (`PrivacyModule.cs` has only `optin`/`optout`). Phase 2.1. |
| Consent before the first habit (4) | No consent step anywhere. Product change, see open question 1. |
| DM failure counter and reminder pause (3.1) | Not implemented yet (`ReminderJob.cs:76-87` only logs). Phase 2.3. |
| "Ember legt einen Eintrag erst an, wenn du eine Funktion nutzt, die etwas speichern muss" (3.1) | True, with one quirk: `/privacy optout` also creates a user row (`HabitService.cs:331` calls `EnsureUserAsync`) even for someone who was never opted in. Harmless, but avoidable. |
| Backup rotation | No backup is set up in this repository. Phase 8.3 plans nightly encrypted `pg_dump`. State only what actually exists. |
| Links to the texts from `/help` and the bot profile | Not there yet (Phase 2.6). |

Also update the root `README.md` "Privacy by default" row and the hosting row ("systemd on Linux", it is Docker) so they don't contradict these texts (Phase 2.7).
