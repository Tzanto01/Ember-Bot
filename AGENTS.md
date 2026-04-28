# OpenWolf Protocol — OpenCode Rules

## Session Start

Before writing any code or answering any technical question, read the following files in order:

1. `.wolf/OPENWOLF.md` — operating protocol and rules
2. `.wolf/cerebrum.md` — learnings, do-not-repeats, decisions
3. `.wolf/memory.md` — chronological action log from previous sessions
4. `.wolf/buglog.json` — open bugs relevant to the current task

Do not skip this step. These files are the ground truth for session context.

## Every Turn

At the end of every turn in which you changed a file, ran a command, fixed a bug, or learned something new, update the wolf files before yielding back to the user:

- `.wolf/memory.md` — append a dated entry describing what was done
- `.wolf/cerebrum.md` — add any new learnings, do-not-repeats, or decisions
- `.wolf/buglog.json` — add or close bug entries as appropriate
- `.wolf/anatomy.md` — update descriptions for any files you read or changed

Do not wait to be reminded. If you finish a task without updating the wolf files, your turn is not complete.

## Before Fixing Any Bug

Read `.wolf/buglog.json` first. The fix may already be documented.

## Before Reading Any File

Check `.wolf/anatomy.md` first. If the description is sufficient, skip the full read.
