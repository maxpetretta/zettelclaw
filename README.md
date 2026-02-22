# Zettelclaw 🦞

A human+agent knowledge system built on Obsidian and OpenClaw.

Zettelclaw sets up an Obsidian vault designed for dual human+agent authorship — evergreen notes, rich linking, frontmatter as API, and automated extraction from conversations to durable knowledge.

## Quick Start

```bash
npx zettelclaw init
```

The wizard asks for a vault path and sync method, then auto-configures everything: templates, plugins, and OpenClaw integration (if detected).

For a fully non-interactive setup:

```bash
npx zettelclaw init --yes --vault ~/my-vault
```

If you already have OpenClaw workspace memory files, run migrate once after init:

```bash
npx zettelclaw migrate
```

## What It Does

- Creates a ready-to-use Obsidian vault with 6 note templates (journal via `journal.md`, evergreen via `evergreen.md`, project, research, contact, writing)
- Seeds starter content on first setup:
  - `01 Notes/Zettelclaw Is Collaborative Memory For Your Agent.md`
  - `00 Inbox/Use Reclaw To Import Old Conversation History.md`
  - Today's journal with a `Done` entry for setup/installation
  - `05 Attachments/OpenClaw Logo.png`
- Configures community plugins (Templater, Linter, Obsidian Git)
- Auto-detects OpenClaw and creates `02 Agent/` symlinks + workspace injection (or compacts numbering when disabled)
- Installs OpenClaw cron jobs for:
  - `zettelclaw-reset` (daily 02:00 local transcript sweep trigger)
  - `zettelclaw-nightly` (daily 03:00 local isolated maintenance pass)
- Sets up frontmatter-driven note types that both humans and AI agents can read/write
- Includes a CLI-orchestrated migration pipeline for existing workspace `memory/` files:
  - Per-file sub-agent jobs (recursive `memory/**/*.md`)
  - One final synthesis pass for `MEMORY.md` and `USER.md`
  - Full recursive cleanup of `memory/` after successful migration
  - Resume support via a state file (`.zettelclaw/migrate-state.json` by default)

## Memory Flow

- Hook layer (`/new` or `/reset`): appends link-free capture to daily journals under `Done`, `Decisions`, `Facts`, and `Open`, then records `SESSION_ID — HH:MM` under `## Sessions` in `03 Journal/`
- Supervised layer (human + agent): updates typed notes directly in `01 Notes/` when meaningful work is done
- Nightly maintenance cron layer (agent-only, isolated): reviews the past day of journals, updates existing `project`/`research`/`contact` notes, writes net-new synthesis to `00 Inbox/`, and flags possible hook/cron drift when journal coverage is missing for 72+ hours
- Linking: nightly maintenance enforces two-way links between journal entries and typed notes (`journal -> note` and `note -> journal/session`)

## CLI Commands

```bash
# Initialize vault + OpenClaw integration
npx zettelclaw init

# Migrate existing workspace memory into the vault
npx zettelclaw migrate

# Programmatically verify setup
npx zettelclaw verify
```

Useful migrate flags:

- `--workspace <path>`: OpenClaw workspace path (default `~/.openclaw/workspace`)
- `--vault <path>`: explicit vault path
- `--model <name>`: model alias/key for migration agents
- `--state-path <path>`: override migration resume state file path
- `--parallel-jobs <n>`: run multiple per-file sub-agent jobs concurrently

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
