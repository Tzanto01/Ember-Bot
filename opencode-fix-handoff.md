# Handoff: OpenCode Support for OpenWolf

## Problem

OpenWolf's `.wolf/` protocol relies on the AI reading `cerebrum.md`, `memory.md`, `buglog.json`, and `OPENWOLF.md` at the start of every session. The existing `copilot-instructions.md` instructs GitHub Copilot to do this, but Copilot has no mechanism to proactively read arbitrary files — it only follows instructions if the content is already in its context window.

OpenCode (and similar CLI agent tools) is different: it has full filesystem access and can read any file on demand. However, it still needs to be explicitly told to read the wolf files. Without a project rules file, it won't do so automatically.

## Fix

OpenCode natively supports an `AGENTS.md` file in the project root. This file is loaded automatically into context at the start of every session — no hooks, no manual steps, no configuration required.

The fix is to create `AGENTS.md` with explicit instructions to read the wolf files at session start and update them at the end of every turn.

## What to Add to a Clean Installation

Create `AGENTS.md` in the project root with the following content:

```markdown
# <Project Name> — OpenCode Rules

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
```

## Notes

- `AGENTS.md` should be **committed to git**. Unlike `.wolf/` itself (which is git-ignored and stays local), `AGENTS.md` is project-wide config that benefits all contributors and AI sessions.
- This fix applies to **OpenCode specifically**. The existing `copilot-instructions.md` remains the correct mechanism for GitHub Copilot — it just cannot enforce file reads the way OpenCode can.
- OpenCode also supports a `opencode.json` with an `instructions` field if you want to load wolf files directly by path rather than relying on the AI to follow instructions. That would be a stronger guarantee but requires more setup per project.
- The `AGENTS.md` file is also compatible with other agents that follow the AGENTS.md convention (e.g. tools migrating from Claude Code).

## Recommendation for openwolf-copilot

Add `AGENTS.md` generation to the `openwolf init` command alongside the existing `copilot-instructions.md` generation. When a project is initialized, both files should be written:

- `.github/copilot-instructions.md` — for GitHub Copilot
- `AGENTS.md` — for OpenCode and compatible agents
