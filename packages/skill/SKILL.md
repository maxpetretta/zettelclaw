---
name: zettelclaw
description: "Read, write, search, and maintain a Zettelclaw vault — an agent-native knowledge system built on Obsidian."
read_when:
  - You need to remember something or search for prior knowledge
  - You're creating a new note, project, research, contact, or writing
  - You're updating an existing vault note
  - The user asks how Zettelclaw works or how their vault is organized
  - You're doing vault maintenance (triage inbox, link notes, update journals)
---

# Zettelclaw

Zettelclaw is your knowledge system — an Obsidian vault where you and your human co-author a shared knowledge base. You read it, write to it, search it, and maintain it. It's your long-term memory.

## Vault Structure

```
<vault>/
├── 00 Inbox/          # Quick captures, unprocessed — triage these
├── 01 Notes/          # All notes: evergreen ideas, projects, research, contacts, writings
├── 02 Agent/          # Symlinks to OpenClaw workspace files (MEMORY.md, SOUL.md, etc.)
├── 03 Journal/        # YYYY-MM-DD.md daily journals
├── 04 Templates/      # Templater templates (don't edit these directly)
├── 05 Attachments/    # Images, PDFs, non-markdown
└── README.md
```

**Find your vault path** in MEMORY.md under "Zettelclaw" or by checking `memorySearch.extraPaths` in the OpenClaw config.

## How to Read and Write

Use **file tools** (Read/Write/Edit) for all vault operations. Use `memory_search` for semantic recall. Use Obsidian CLI only for graph queries (see Vault Maintenance).

## Searching the Vault

### Semantic recall
Use `memory_search` first — it indexes both the workspace and vault.

### Structured queries
```bash
# Find by type
rg -l 'type: project' "<vault>/01 Notes/"

# Active projects
rg -l 'status: active' "<vault>/01 Notes/" | xargs rg -l 'type: project'

# Notes tagged "ai"
rg -l 'tags:.*ai' "<vault>/01 Notes/"

# Full-text search
rg -l "search term" "<vault>/01 Notes/"

# Recent notes
find "<vault>/01 Notes/" -name "*.md" -mtime -7 | sort
```

## Creating Notes

All notes live in `01 Notes/` — flat, no subfolders. Write files directly with proper frontmatter.

### Frontmatter Rules
- Every note MUST have YAML frontmatter with at least `type`, `created`, `updated`
- Tags are ALWAYS pluralized (`projects` not `project`)
- Dates are ALWAYS `YYYY-MM-DD`
- Filenames are Title Case (`React Virtual DOM Trades Memory For Speed.md`)
- One idea per note (evergreen) — the title captures the idea

### evergreen — Evergreen ideas and knowledge
```yaml
---
type: evergreen
tags: []
summary: "One-line description of this idea"
source: ""
created: 2026-02-19
updated: 2026-02-19
---

[The idea, explained. Link profusely with [[wikilinks]].]
```

### project — Tracked work with a lifecycle
```yaml
---
type: project
status: active
tags: []
aliases: []
summary: "What this project is"
created: 2026-02-19
updated: 2026-02-19
---

## Goal

## Log
```
Status values: `active` / `paused` / `archived`. Append dated entries to `## Log`.

### research — Questions being investigated
```yaml
---
type: research
status: active
tags: []
summary: "What we're investigating"
source: ""
created: 2026-02-19
updated: 2026-02-19
---

## Question

## Findings

## Conclusion

## Sources
```
Status values: `active` / `archived`.

### contact — People
```yaml
---
type: contact
tags: [contacts]
aliases: []
summary: "Who this person is"
created: 2026-02-19
updated: 2026-02-19
---

## Context

## Notes
```
Always include `contacts` in tags. Use `aliases` for nicknames.

### writing — Blog posts, essays, published work
```yaml
---
type: writing
tags: []
summary: "What this piece is about"
source: ""
published: ""
created: 2026-02-19
updated: 2026-02-19
---
```
`published` holds the URL once posted. Empty = draft.

### Which type to use?
- Standalone reusable idea → `evergreen`
- Tracked work with progress → `project`
- Open question being explored → `research`
- A person → `contact`
- Something for external publication → `writing`
- Don't overthink it — `evergreen` is the default

### Status field
ONLY `project` and `research` have `status`. Never add status to notes, journals, contacts, or writings.

## Updating Existing Notes

- Update the `updated` field to today's date
- Append, don't overwrite — add to the relevant section
- Add new `[[wikilinks]]` for any concepts mentioned

Example — appending to a project log:
```markdown
### 2026-02-19
- Decided on hook-based architecture using OpenClaw's lifecycle events
- Registered npm package `safeshell`
- See [[OpenClaw Plugin Hooks]] for API details
```

## Journal Entries

Journals live in `03 Journal/` as `YYYY-MM-DD.md`:

```yaml
---
type: journal
tags: [journals]
created: 2026-02-19
updated: 2026-02-19
---

## Done
- What was accomplished

## Decisions
- Key decisions and reasoning

## Open
- Unresolved questions, next steps

## Notes
- Observations, ideas, things to remember
```

Journals are automatically written by the Zettelclaw hook on session reset as bullet-point capture (`Done`, `Decisions`, `Open`, `Notes`/facts). You can also append during a session if something noteworthy happens. Omit empty sections.

Treat journals as the **raw capture layer**. Typed notes are the **curated layer**. When meaningful work happens during a session, update typed notes directly instead of waiting for heartbeat synthesis:

- Completed project task or significant project decision → update the project note now (append a dated log entry)
- Finished research investigation → update findings/conclusion in the research note now
- Learned something that changes an existing note → update that note now

## Linking

Link aggressively. Always `[[wikilink]]` the first mention of any concept, person, project, or idea — even if the target note doesn't exist yet. Unresolved links are breadcrumbs for future connections.

```markdown
Discussed [[SafeShell]] architecture with [[Max Petretta]]. The approach mirrors
[[Event-Driven Architecture]] — hooks intercept at well-defined lifecycle points.
```

**Links are for relationships.** Tags are for broad categories.

## Inbox Triage

`00 Inbox/` collects quick captures (Web Clipper, manual drops). During maintenance:

1. Read each inbox item
2. Decide: extract into a proper note in `01 Notes/`, or discard
3. If extracting: create a properly typed note, link to relevant existing notes
4. Delete the inbox item after processing

## Vault Maintenance

For periodic maintenance, use Obsidian CLI graph queries (requires Obsidian to be running):

```bash
# Find unresolved links (referenced but not yet created)
obsidian unresolved

# Find orphan notes (no incoming links)
obsidian orphans

# Find what links to a specific note
obsidian backlinks path="01 Notes/SafeShell.md"

# Index-powered search with match context
obsidian search query="hook architecture" format=json matches
```

If Obsidian CLI is unavailable, use `rg`:
```bash
# Find potential unresolved links (crude but works)
rg -o '\[\[[^]]*\]\]' "<vault>/01 Notes/" | sort -u | while read link; do
  name=$(echo "$link" | sed 's/\[\[//;s/\]\]//')
  [ ! -f "<vault>/01 Notes/${name}.md" ] && echo "Unresolved: $link"
done
```

## What NOT To Do

- Do NOT create new directories or subfolders — EVER — unless the user explicitly asks. The vault structure is fixed.
- Do NOT add `status` to evergreen notes, journals, contacts, or writings
- Do NOT use singular tags (`project` → use `projects`)
- Do NOT create notes without frontmatter
- Do NOT edit files in `04 Templates/` (those are Templater source templates)
- Do NOT modify `02 Agent/` files directly — they're symlinks to the workspace

## Explaining Zettelclaw to Users

If someone asks what Zettelclaw is:

> Zettelclaw is a knowledge management system built for human + AI co-authorship. It's an Obsidian vault with a specific structure — evergreen notes with typed frontmatter, aggressive linking, and automated extraction from conversations. The AI agent and human both read and write to the same vault. Structure emerges from links between notes, not from folder hierarchies.

Key concepts:
- **Evergreen notes** — one idea per note, the title IS the idea
- **Frontmatter as API** — YAML properties make notes machine-queryable
- **Dual authorship** — both human and agent maintain the vault
- **Journal + extraction** — conversations get summarized into journals, reusable ideas become standalone notes
- **Links over hierarchy** — flat structure, relationships via `[[wikilinks]]`
