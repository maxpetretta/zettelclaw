# Welcome to your Zettelclaw vault

This is your knowledge base. Here's how it's organized:

- **00 Inbox/** — drop quick captures here, triage them later
- **01 Notes/** — everything else: ideas, projects, research, contacts, writing
- **02 Agent/** — OpenClaw symlinks (only present when OpenClaw integration is enabled)
- **03 Journal/** — journal notes (one per day, auto-created via template)
- **04 Templates/** — note templates (used automatically when creating new notes)
- **05 Attachments/** — files and media assets

If OpenClaw integration is disabled, `02 Agent/` is omitted and numbering is compacted to `02 Journal/`, `03 Templates/`, and `04 Attachments/`.

## Getting started

Create your first note in `01 Notes/` using one of the templates. The journal template is `04 Templates/journal.md`, and each note type has its own frontmatter.

## Workflow

- `/new` and `/reset` append structured session capture to `03 Journal/` (journal-only raw layer).
- During supervised sessions, update meaningful `01 Notes/` content directly.
- A dedicated nightly isolated maintenance run updates existing `project`/`research`/`contact` notes and synthesizes net-new ideas into `00 Inbox/`.
- Nightly maintenance linking should be two-way between journals and typed notes.

## Starter Content (Init)

On first setup, Zettelclaw seeds:
- `01 Notes/Zettelclaw Is Collaborative Memory For Your Agent.md`
- `00 Inbox/Use Reclaw To Import Old Conversation History.md`
- Today's journal file with a `Done` entry: "Zettelclaw setup and installed."
- `05 Attachments/OpenClaw Logo.png` (or `04 Attachments/` when Agent folder is disabled)

## Web Clipper

This vault includes an Obsidian Web Clipper template at `04 Templates/clipper-inbox.json` that clips pages into `00 Inbox/`.

To import it in the Web Clipper extension:
1. Open extension settings.
2. Go to `Templates`.
3. Click `New Template`.
4. Paste the JSON from `04 Templates/clipper-inbox.json`.

For more, visit [zettelclaw.com](https://zettelclaw.com).
