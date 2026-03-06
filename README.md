# Zettelclaw 🦞

Opinionated Obsidian vault template + CLI for human/agent knowledge work with OpenClaw.

Zettelclaw gives you:

- a pre-configured Obsidian vault scaffold
- minimal templates (`note`, `journal`, and Web Clipper capture)
- an inbox Base view (`00 Inbox/inbox.base`)
- bundled plugin install during `init`
- OpenClaw integration through vault memory paths
- QMD collection setup for inbox, notes, and journal
- a universal Web Clipper template that works across source types (including Twitter and YouTube)
- a vault-specific agent skill
- a single-page marketing site

## Quick start

```bash
npx zettelclaw init
npx zettelclaw verify
```

## What `init` configures

- Vault folders:
  - `00 Inbox/`
  - `01 Notes/`
  - `02 Journal/`
  - `03 Templates/`
  - `04 Attachments/`
- Obsidian plugin defaults (Calendar, optional Obsidian Git)
- Note templates for `note` and `journal`
- Universal Web Clipper template JSON in `03 Templates/`:
  - `clipper-capture.json`
  - classify captures by `type` (`article`, `tweet`, `youtube`) + `status: queued`
- Base view:
  - `00 Inbox/inbox.base`
- QMD collections (when `qmd` is installed):
  - `zettelclaw-<vault>-inbox`
  - `zettelclaw-<vault>-notes`
  - `zettelclaw-<vault>-journal`
- OpenClaw integration:
  - `agents.defaults.memorySearch.extraPaths` patch in OpenClaw config to include vault path

## Commands

```bash
# Install/configure vault and OpenClaw integration (if workspace exists)
npx zettelclaw init

# Verify vault structure, templates, plugins, QMD collections, and OpenClaw wiring
npx zettelclaw verify
```

Useful flags:

- `--vault <path>`
- `--workspace <path>`
- `--sync <git|obsidian-sync|none>`
- `--theme <minimal|obsidian>`
- `--yes`

## Repo layout

- `packages/cli` - installer + verifier CLI
- `packages/skill` - vault-specific skill guidance
- `packages/website` - single-page marketing site

## License

MIT
