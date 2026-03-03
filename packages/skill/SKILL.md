---
name: zettelclaw
description: "Work directly inside a Zettelclaw vault with typed notes, queue workflows, and dataview dashboards."
read_when:
  - The user asks to create, update, or search vault notes
  - The user asks about reading list, watch list, or read-it-later workflows
  - The user asks how Zettelclaw vault structure works
---

# Zettelclaw

Zettelclaw is an opinionated Obsidian vault for human + agent collaboration. It uses flat folders, typed frontmatter, and queue dashboards for ongoing work.

## Vault structure

```
<vault>/
├── 00 Inbox/
├── 01 Notes/
├── 02 Agent/        # symlinks to OpenClaw workspace files when integration is enabled
├── 03 Journal/
├── 04 Templates/
├── 05 Attachments/
└── README.md
```

If OpenClaw integration is off, `02 Agent/` is absent and folder numbering compacts.

## Note types

Use YAML frontmatter on every note with at least `type`, `created`, `updated`.

- `evergreen`: durable ideas
- `project`: tracked work (`status: active|paused|archived`)
- `research`: open investigations (`status: active|archived`)
- `contact`: people notes
- `writing`: publishable drafts
- `journal`: daily logs
- `read-it-later`: captured links in `00 Inbox/`
- `reading`: reading queue items in `01 Notes/`
- `watch`: watch queue items in `01 Notes/`

## Templates

Always read the matching template in `04 Templates/` before creating a note:

- `evergreen.md`
- `project.md`
- `research.md`
- `contact.md`
- `writing.md`
- `journal.md`
- `read-it-later.md`
- `reading-item.md`
- `watch-item.md`

## Queue workflows

Web Clipper templates are in `04 Templates/`:

- `clipper-read-it-later.json` -> `00 Inbox/`
- `clipper-reading-list.json` -> `01 Notes/`
- `clipper-watch-list.json` -> `01 Notes/`
- `clipper-twitter-bookmark.json` -> `00 Inbox/`
- `clipper-youtube-watch.json` -> `01 Notes/`

Dashboard note:

- `01 Notes/Media Queues Dashboard.md` (Dataview tables for all queues)

## Editing rules

- Prefer appending over rewriting existing content.
- Keep filenames in Title Case.
- Update `updated` whenever a note changes.
- Link related notes with `[[wikilinks]]`.
- Do not create new top-level folders unless the user explicitly asks.
- Do not edit `02 Agent/*` targets directly; they are workspace symlinks.

## Search patterns

```bash
# projects
rg -l 'type: project' "<vault>/01 Notes/"

# reading queue
rg -l 'type: reading' "<vault>/01 Notes/"

# watch queue
rg -l 'type: watch' "<vault>/01 Notes/"

# read-it-later captures
rg -l 'type: read-it-later' "<vault>/00 Inbox/"
```
