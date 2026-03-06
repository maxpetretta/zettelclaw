# Welcome to your Zettelclaw vault

This vault follows the canonical Zettelclaw spec: capture in inbox, write durable notes, and let an agent help you navigate what you wrote.

- **00 Inbox/** - unprocessed captures from Web Clipper
- **01 Notes/** - durable notes and content references
- **02 Journal/** - daily notes (`YYYY-MM-DD.md`)
- **03 Templates/** - core note templates and Web Clipper template
- **04 Attachments/** - files embedded in notes

## Included templates

- `03 Templates/note.md`
- `03 Templates/journal.md`
- `03 Templates/clipper-capture.json`

## Included Base view

- `00 Inbox/inbox.base`

## QMD integration

If `qmd` is installed, `zettelclaw init` creates collections for:

- `zettelclaw-inbox`
- `zettelclaw-notes`
- `zettelclaw-journal`
- `zettelclaw-attachments`

## OpenClaw integration

When an OpenClaw workspace is detected during `zettelclaw init`, the CLI patches `agents.defaults.memorySearch.extraPaths` so your agent can read this vault as memory context, and installs the bundled `zettelclaw` skill into OpenClaw's managed `skills/` directory.

## Agent integration

Agent context is provided by the Zettelclaw skill rather than vault-level agent files. See `SKILL.md` in the skill package for the full agent guide.
