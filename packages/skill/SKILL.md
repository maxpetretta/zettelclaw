---
name: zettelclaw
description: "Read, write, search, and maintain a Zettelclaw vault — an agent-native knowledge system built on Obsidian."
read_when:
  - You need to remember something or search for prior knowledge
  - You're creating or updating a vault note
  - The user asks how Zettelclaw works
  - You're doing vault maintenance
---

# Zettelclaw

Zettelclaw is your knowledge system — an Obsidian vault where you and your human co-author a shared knowledge base. You read it, write to it, search it, and maintain it.

## Vault Structure

```
<vault>/
├── 00 Inbox/          # Quick captures, unprocessed — triage these
├── 01 Notes/          # All typed notes: evergreen, project, research, contact
├── 02 Agent/          # Symlinks to OpenClaw workspace files
├── 03 Journal/        # YYYY-MM-DD.md daily journals
├── 04 Templates/      # Templater templates (don't edit)
├── 05 Attachments/    # Images, PDFs, non-markdown
```

## Three-Layer Memory

1. **Hook (`/new` or `/reset`) → Journal only:** Append raw capture to `03 Journal/`, no wikilinks, no note creation
2. **Supervised sessions → Notes:** Update typed notes in `01 Notes/` when meaningful work happens
3. **Nightly cron → Maintenance:** Update existing notes from journal evidence, put net-new ideas in `00 Inbox/`

## Note Types

Four types. When in doubt, use `evergreen`.

| Type | Title style | Sections |
|---|---|---|
| **evergreen** | Statement/claim | Freeform prose (1-3 paragraphs) |
| **project** | `<Name> Project` | `## Goal` → `## Log` |
| **research** | `<Topic> Research` | `## Question` → `## Findings` → `## Conclusion` → `## Sources` |
| **contact** | Person's name | `## Context` → `## Notes` |

### Notes Are Claims, Not Topics
Every evergreen title should be a **statement you can learn from** — not a category label. "SQLite Outperforms Postgres For Single-Server Workloads" is a note. "Tech Stack" is a wiki page. The body argues the claim in 1-3 short paragraphs.

Project and contact notes are containers — their titles are names, not claims.

### Content Filter
Before writing any note, ask: **"Would I need to know this person to know this?"** If a general-purpose LLM could produce it without user context, it doesn't belong. No general knowledge, no dependency lists, no version inventories.

## Frontmatter

Every note MUST have:
- `type`: `evergreen`, `project`, `research`, or `contact`
- `tags`: ALWAYS pluralized (`projects` not `project`)
- `created`: `YYYY-MM-DD`
- `updated`: `YYYY-MM-DD`

All note types have `summary` (one-sentence description).

Do NOT add `status`, `source`, or `aliases`.

## Naming

- Filenames are Title Case
- Project filenames end with `Project`
- Research filenames end with `Research`
- Evergreen filenames are statements, not topics

## Journals

Journals live in `03 Journal/YYYY-MM-DD.md`:

```markdown
---
type: journal
tags: [journals]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
## Log
- What happened, decisions made, facts learned

## Todo
- Unresolved items

---
## Sessions
- SESSION_ID — HH:MM
```

**Hook capture** appends bullets to `## Log` and `## Todo`, then adds session provenance to `## Sessions`. Hook output is link-free, journal-only, append-only.

**During supervised sessions**, update typed notes directly when meaningful work happens — don't wait for nightly synthesis.

**Nightly maintenance** adds wikilinks to journals and enforces two-way links between journals and typed notes.

## Linking

Link aggressively with `[[wikilinks]]`. Even to notes that don't exist yet — unresolved links are breadcrumbs.

Exception: hook-generated journal capture stays link-free. Links are added during nightly maintenance.

## Updating Notes

- Update `updated` to today's date
- Append, don't overwrite
- Add `[[wikilinks]]` for concepts mentioned

## Inbox Triage

`00 Inbox/` collects Web Clipper captures and nightly synthesis drafts. In supervised sessions, promote approved notes to `01 Notes/`. In nightly maintenance, leave drafts in `00 Inbox/`.

## Searching

1. **`memory_search`** for semantic recall (indexes vault + workspace)
2. **`rg`** for structured queries:
```bash
rg -l 'type: project' "<vault>/01 Notes/"
rg -l 'tags:.*ai' "<vault>/01 Notes/"
```

## What NOT To Do

- Do NOT create new directories
- Do NOT add `status` to notes
- Do NOT create notes without frontmatter
- Do NOT create net-new nightly notes directly in `01 Notes/` (use `00 Inbox/`)
- Do NOT edit `04 Templates/` or `02 Agent/` files
