# OpenWolf — GitHub Copilot Instructions

## OpenWolf — Read First, Every Session

If `.claude/rules/openwolf.md` exists, follow it before reading or editing project files. Treat it as the global rule layer for every instruction in this repo.

Then follow `.wolf/OPENWOLF.md` for the operating protocol and keep `.wolf/anatomy.md`, `.wolf/cerebrum.md`, and `.wolf/memory.md` updated when you learn something or change files.

### OpenWolf Read Rule — Non-Negotiable

**At the START of EVERY session, before writing any code or answering any technical question, you MUST read the following wolf files in order:**

1. `.wolf/cerebrum.md` — learnings, do-not-repeats, decisions. This tells you what mistakes have already been made and what patterns are established.
2. `.wolf/memory.md` — the chronological action log. This tells you what was done last session so you have continuity.
3. `.wolf/buglog.json` — open bugs. Check for anything relevant to the current task before starting.

Do not skip this step even if you think you already know the codebase. The wolf files are the ground truth for this session's context.

### OpenWolf Update Rule — Non-Negotiable

**At the end of EVERY turn in which you changed a file, ran a command, fixed a bug, or learned something new, you MUST update the wolf files before yielding back to the user.** This is not optional bookkeeping — it is part of the definition of "done".

- `.wolf/memory.md` — append a dated entry describing what was done.
- `.wolf/cerebrum.md` — add any new learnings, do-not-repeats, or decisions.
- `.wolf/buglog.json` — add or close bug entries as appropriate.

Do not wait to be reminded. Do not treat wolf updates as a follow-up step. If you finish a task and have not updated the wolf files, **your turn is not complete**.

### OpenWolf Maintenance Rule

Because the automated cron daemon is not running in Copilot sessions, file housekeeping must be done inline. **Check file sizes when reading wolf files at session start and apply the relevant rule if the threshold is met:**

| File | Threshold | Action |
|---|---|---|
| `.wolf/memory.md` | > 100 lines | Consolidate entries older than 7 days into a single dated summary line per session. Keep the last 7 days verbatim. |
| `.wolf/cerebrum.md` | > 80 lines | Prune: remove Do-Not-Repeat entries older than 90 days if no longer relevant; merge Key Learnings that say the same thing; keep the file under 60 lines. |
| `.wolf/buglog.json` | > 20 bug entries | Archive closed bugs (status = "CLOSED") into a separate section, keeping only open bugs in the active list. |

Do this as part of the session-start read step — not as a separate task. If consolidation was performed, note it in `memory.md`.
