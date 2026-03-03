# Welcome to your Zettelclaw vault

This vault is tuned for human + agent collaboration with Obsidian and OpenClaw.

- **00 Inbox/** - raw captures and read-it-later drops
- **01 Notes/** - durable notes, projects, research, and queue items
- **02 Agent/** - symlinks to key OpenClaw workspace files (when integration is enabled)
- **03 Journal/** - daily journals (`YYYY-MM-DD.md`)
- **04 Templates/** - Templater note templates and Web Clipper JSON templates
- **05 Attachments/** - files and media

If OpenClaw integration is disabled, `02 Agent/` is omitted and numbering compacts to `02 Journal/`, `03 Templates/`, and `04 Attachments/`.

## Included workflows

- Typed notes for `evergreen`, `project`, `research`, `contact`, and `writing`
- Queue templates for `read-it-later`, `reading`, and `watch`
- Web Clipper templates for:
  - `clipper-read-it-later.json`
  - `clipper-reading-list.json`
  - `clipper-watch-list.json`
  - `clipper-twitter-bookmark.json`
  - `clipper-youtube-watch.json`
- Dataview dashboard: `01 Notes/Media Queues Dashboard.md`

## OpenClaw integration

When an OpenClaw workspace is detected during `zettelclaw init`, the CLI:

- creates `02 Agent/` symlinks for `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, and `MEMORY.md`
- patches OpenClaw config `memorySearch.extraPaths` so your agent can read the vault as memory context

## Web Clipper import

In the Obsidian Web Clipper extension:

1. Open extension settings.
2. Go to `Templates`.
3. Click `New Template`.
4. Paste one of the JSON templates from `04 Templates/`.
