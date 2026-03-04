# Zettelclaw 🦞

Opinionated Obsidian vault template + CLI for human/agent knowledge work with OpenClaw.

Zettelclaw gives you:

- a pre-configured Obsidian vault scaffold
- typed note templates
- bundled plugin install via CLI
- OpenClaw integration through vault memory paths
- QMD collection setup for each root vault folder
- Web Clipper templates for read-it-later / reading list / watch list, including Twitter bookmarks and YouTube captures
- Dataview dashboards to surface those queues
- a vault-specific agent skill
- a single-page marketing site

## Quick start

```bash
npx zettelclaw init
npx zettelclaw verify
```

If you want to refresh plugin binaries later:

```bash
npx zettelclaw plugins
```

## What `init` configures

- Vault folders:
  - `00 Inbox/`
  - `01 Notes/`
  - `02 Journal/`
  - `03 Templates/`
  - `04 Attachments/`
- Obsidian plugin defaults (Templater, Linter, Dataview, optional Obsidian Git)
- Note templates for evergreen/project/research/contact/writing/journal
- Queue templates for read-it-later, reading, and watch items
- Web Clipper template JSON files in `03 Templates/`:
  - `clipper-read-it-later.json`
  - `clipper-reading-list.json`
  - `clipper-watch-list.json`
  - `clipper-twitter-bookmark.json`
  - `clipper-youtube-watch.json`
- `01 Notes/Media Queues Dashboard.md` with Dataview tables
- QMD root-folder collections (when `qmd` is installed):
  - `zettelclaw-<vault>-inbox`
  - `zettelclaw-<vault>-notes`
  - `zettelclaw-<vault>-journal`
  - `zettelclaw-<vault>-templates`
  - `zettelclaw-<vault>-attachments`
- OpenClaw integration:
  - `memorySearch.extraPaths` patch in OpenClaw config to include vault path

## Commands

```bash
# Install/configure vault and OpenClaw integration (if workspace exists)
npx zettelclaw init

# Download/refresh plugin binaries
npx zettelclaw plugins

# Verify vault structure, templates, plugins, QMD collections, and OpenClaw wiring
npx zettelclaw verify
```

Useful flags:

- `--vault <path>`
- `--workspace <path>`
- `--sync <git|obsidian-sync|none>`
- `--minimal`
- `--yes`

## Repo layout

- `packages/cli` - installer + verifier CLI
- `packages/skill` - vault-specific skill guidance
- `packages/website` - single-page marketing site

## License

MIT
