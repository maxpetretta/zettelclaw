# Zettelclaw 🦞

> An Obsidian vault your agent can actually read.

A durable [Obsidian](https://obsidian.md) vault scaffold for human/agent knowledge work. Zettelclaw creates a simple five-folder vault, typed markdown templates, inbox capture, [QMD](https://github.com/tobi/qmd) collections, and [OpenClaw](https://openclaw.com) integration — so your agent can search and navigate your notes without inventing its own system.

## Install

```bash
npx zettelclaw init
npx zettelclaw verify
```

`init` creates the vault scaffold, seeds starter notes and templates, configures Obsidian defaults, downloads bundled plugins, initializes Git when selected, creates QMD collections when `qmd` is installed, and patches OpenClaw when a workspace is detected.

## Vault Layout

| Path | Purpose |
|---|---|
| `00 Inbox/` | Unprocessed captures from Web Clipper. |
| `01 Notes/` | Durable notes, working docs, and content references. |
| `02 Journal/` | Daily notes named `YYYY-MM-DD.md`. |
| `03 Templates/` | Core markdown templates plus the clipper template JSON. |
| `04 Attachments/` | Files embedded in notes. |

Starter content includes `01 Notes/Zettelclaw Vault Principles.md`, `00 Inbox/Build A Capture Habit.md`, and `02 Journal/<today>.md`.

### Seeded files

| File | Purpose |
|---|---|
| `03 Templates/note.md` | Durable note template with typed frontmatter. |
| `03 Templates/journal.md` | Daily journal template. |
| `03 Templates/clipper-capture.json` | Universal Web Clipper capture template. |
| `00 Inbox/inbox.base` | Canonical inbox triage view. |

## Integrations

- **QMD** — creates `zettelclaw-inbox`, `zettelclaw-notes`, `zettelclaw-journal`, and `zettelclaw-attachments` collections when `qmd` is available
- **OpenClaw** — patches `agents.defaults.memorySearch.extraPaths` and installs the bundled `zettelclaw` skill when a workspace is available
- **Obsidian defaults** — enables Calendar, optional Obsidian Git, and the Minimal theme preset/tooling when selected

## CLI Reference

```bash
zettelclaw init                # create and configure a Zettelclaw vault
zettelclaw verify              # validate vault, plugins, QMD, and OpenClaw wiring

zettelclaw init --vault        # override vault path
zettelclaw init --workspace    # override OpenClaw workspace path
zettelclaw init --sync         # git | obsidian-sync | none
zettelclaw init --theme        # minimal | obsidian
zettelclaw init --yes          # accept defaults non-interactively
```

`verify` also supports `--vault`, `--workspace`, and `--yes`.

## Packages

| Package | Description |
|---|---|
| [`zettelclaw`](packages/cli) | Obsidian vault scaffolding and verification CLI (npm) |
| [`@zettelclaw/skill`](packages/skill) | Agent skill instructions (ClawHub) |
| [`@zettelclaw/website`](packages/website) | Landing page — [zettelclaw.com](https://zettelclaw.com) |

## Architecture

See [docs/SPEC.md](docs/SPEC.md) for the full Zettelclaw product and vault contract.

## License

MIT
