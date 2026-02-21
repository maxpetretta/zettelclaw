# Zettelclaw 🦞

A human+agent knowledge system built on Obsidian and OpenClaw.

Zettelclaw sets up an Obsidian vault designed for dual human+agent authorship — evergreen notes, rich linking, frontmatter as API, and automated extraction from conversations to durable knowledge.

## Quick Start

```bash
npx zettelclaw init
# or
bunx zettelclaw init
```

The wizard asks for a vault path and sync method, then auto-configures everything: templates, plugins, and OpenClaw integration (if detected).

For a fully non-interactive setup:

```bash
npx zettelclaw init --yes --vault ~/my-vault
```

## What It Does

- Creates a ready-to-use Obsidian vault with 6 note templates (journal via `journal.md`, evergreen via `evergreen.md`, project, research, contact, writing)
- Configures community plugins (Templater, Linter, Obsidian Git)
- Auto-detects OpenClaw and creates `02 Agent/` symlinks + workspace injection (or compacts numbering when disabled)
- Sets up frontmatter-driven note types that both humans and AI agents can read/write

## Web Clipper Template

The project ships an Obsidian Web Clipper template at `vault/04 Templates/clipper-inbox.json` that captures clips into `00 Inbox/`.

Import steps in the Web Clipper extension:
1. Open extension settings.
2. Go to `Templates`.
3. Click `New Template`.
4. Paste the JSON from `vault/04 Templates/clipper-inbox.json`.

## Links

- [zettelclaw.com](https://zettelclaw.com) (coming soon)
- [GitHub](https://github.com/maxpetretta/zettelclaw)

## License

MIT
