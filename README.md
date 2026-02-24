# Zettelclaw 🦞

> Your agent's second brain, built together.

A PKM system for humans and AI agents to co-build a shared knowledge base, powered by Obsidian and OpenClaw.

## Quick Start

```bash
npx zettelclaw init
```

The wizard asks for a vault path and sync method, then configures everything: templates, plugins, and OpenClaw integration (if detected).

For a non-interactive setup:

```bash
npx zettelclaw init --yes --vault ~/my-vault
```

If you have existing OpenClaw workspace memory files, migrate them once after init:

```bash
npx zettelclaw migrate
```

## What It Does

- Creates an Obsidian vault with 5 note templates (journal, evergreen, project, research, contact)
- Configures community plugins (Templater, Linter, Obsidian Git)
- Auto-detects OpenClaw and wires up `02 Agent/` symlinks, workspace injection, and cron jobs
- Seeds starter content: an evergreen note, an inbox note, today's journal, and the OpenClaw logo

## Memory Flow

```
Hook (/new, /reset)  →  Journal (raw capture, no links)
                            ↓
Supervised session   →  Typed notes in 01 Notes/ (human + agent)
                            ↓
Nightly maintenance  →  Update existing notes, synthesize to 00 Inbox/, enforce two-way links
```

All content passes a hard filter: only user-specific knowledge enters the vault. General knowledge that any LLM could produce without user context is excluded.

## Vault Structure

```
00 Inbox/        — quick captures, agent synthesis drafts (triage these)
01 Notes/        — typed notes: evergreen, project, research, contact
02 Agent/        — OpenClaw symlinks (when integration is enabled)
03 Journal/      — YYYY-MM-DD.md daily journals
04 Templates/    — Templater note templates
05 Attachments/  — images, PDFs, non-markdown
```

## CLI Commands

```bash
npx zettelclaw init         # Initialize vault + OpenClaw integration
npx zettelclaw migrate      # Migrate existing workspace memory into the vault
npx zettelclaw verify       # Programmatically verify setup
npx zettelclaw uninstall    # Remove OpenClaw integration
```

## Web Clipper

The vault includes an Obsidian Web Clipper template at `04 Templates/clipper-inbox.json` for capturing pages into `00 Inbox/`.

## Links

- [zettelclaw.com](https://zettelclaw.com) (coming soon)
- [GitHub](https://github.com/maxpetretta/zettelclaw)

## License

MIT
