# Ember — OpenCode Rules

## OpenWolf Protocol

This project uses OpenWolf for persistent AI memory. At the start of every session, before writing any code or answering any technical question, read the following files in order:

1. `.wolf/OPENWOLF.md` — operating protocol and rules
2. `.wolf/cerebrum.md` — learnings, do-not-repeats, decisions
3. `.wolf/memory.md` — chronological action log from previous sessions
4. `.wolf/buglog.json` — open bugs relevant to the current task

Do not skip this step. These files are the ground truth for session context.

## OpenWolf Update Rule

At the end of every turn in which you changed a file, ran a command, fixed a bug, or learned something new, update the wolf files before yielding back to the user:

- `.wolf/memory.md` — append a dated entry describing what was done
- `.wolf/cerebrum.md` — add any new learnings, do-not-repeats, or decisions
- `.wolf/buglog.json` — add or close bug entries as appropriate
- `.wolf/anatomy.md` — update descriptions for any files you read or changed
