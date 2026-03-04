# Welcome to your Zettelclaw vault

This vault is tuned for human + agent collaboration with Obsidian and OpenClaw.

- **00 Inbox/** - raw captures and read-it-later drops
- **01 Notes/** - durable notes, projects, research, and queue items
- **02 Journal/** - daily journals (`YYYY-MM-DD.md`)
- **03 Templates/** - Templater note templates and Web Clipper JSON templates
- **04 Attachments/** - files and media

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
- QMD root-folder collections (created by `zettelclaw init` when `qmd` is installed)

## OpenClaw integration

When an OpenClaw workspace is detected during `zettelclaw init`, the CLI:

- patches OpenClaw config `memorySearch.extraPaths` so your agent can read the vault as memory context

## QMD integration

If `qmd` is available, `zettelclaw init` creates one collection per root vault folder:

- `zettelclaw-<vault>-inbox`
- `zettelclaw-<vault>-notes`
- `zettelclaw-<vault>-journal`
- `zettelclaw-<vault>-templates`
- `zettelclaw-<vault>-attachments`

## Web Clipper import

In the Obsidian Web Clipper extension:

1. Open extension settings.
2. Go to `Templates`.
3. Click `New Template`.
4. Paste one of the JSON templates from `03 Templates/`.
