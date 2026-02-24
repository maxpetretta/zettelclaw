# Welcome to your Zettelclaw vault

This is your knowledge base. Here's how it's organized:

- **00 Inbox/** — quick captures and agent synthesis drafts (triage these)
- **01 Notes/** — typed notes: ideas, projects, research, contacts
- **02 Agent/** — OpenClaw symlinks (only when integration is enabled)
- **03 Journal/** — daily journals (one per day, auto-populated by session hooks)
- **04 Templates/** — note templates (used automatically when creating new notes)
- **05 Attachments/** — files and media assets

When OpenClaw integration is disabled, `02 Agent/` is omitted and numbering compacts.

## Workflow

1. **Hook layer** — `/new` and `/reset` append structured capture to `03 Journal/` (raw, no links)
2. **Supervised layer** — during sessions, update meaningful notes directly in `01 Notes/`
3. **Nightly layer** — an isolated maintenance pass updates existing notes, synthesizes new ideas into `00 Inbox/`, and enforces two-way links between journals and notes

## Getting Started

Create your first note in `01 Notes/` using one of the templates. If you had existing OpenClaw workspace memory files, run `zettelclaw migrate` once.

For more, visit [zettelclaw.com](https://zettelclaw.com).
