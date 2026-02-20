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
├── 01 Notes/          # All notes: atomic ideas, projects, research, contacts, writings
├── 02 Agent/          # Symlinks to OpenClaw workspace files (MEMORY.md, SOUL.md, etc.)
├── 03 Journal/        # YYYY-MM-DD.md daily journals
├── 04 Templates/      # Templater templates (don't edit these directly)
├── 05 Attachments/    # Images, PDFs, non-markdown
└── README.md
```

**Find your vault path** in MEMORY.md under "Zettelclaw Vault" or by checking `memorySearch.extraPaths` in the OpenClaw config.

## Searching the Vault

Use `memory_search` first — it indexes both the workspace and the vault semantically. For structured queries, use `exec`:

```bash
# Find all projects
grep -rl 'type: project' "<vault>/01 Notes/"

# Active projects only
grep -rl 'status: active' "<vault>/01 Notes/" | xargs grep -l 'type: project'

# Notes tagged "ai"
grep -rl 'tags:.*ai' "<vault>/01 Notes/"

# All contacts
grep -rl 'type: contact' "<vault>/01 Notes/"

# Full-text search
grep -rl "search term" "<vault>/01 Notes/"

# Recent notes by modification time
find "<vault>/01 Notes/" -name "*.md" -mtime -7 | sort
```

When recalling information: try `memory_search` first, then fall back to grep/find if you need structured filtering.

## Writing Notes

All notes live in `01 Notes/` — flat, no subfolders. Type differentiation happens in frontmatter, not folders.

### Frontmatter Rules
- Every note MUST have YAML frontmatter with at least `type`, `created`, `updated`
- Tags are ALWAYS pluralized (`projects` not `project`, `contacts` not `contact`)
- Dates are ALWAYS `YYYY-MM-DD`
- Filenames are Title Case (`React Virtual DOM Trades Memory For Speed.md`)
- One idea per note (atomic) — the title captures the idea

### Note Types

#### note — Atomic ideas and knowledge
```yaml
---
type: note
tags: []
summary: "One-line description of this idea"
source: ""
created: 2026-02-19
updated: 2026-02-19
---
```
The body is the explanation. No prescribed sections. Link profusely with `[[wikilinks]]`.

#### project — Tracked work with a lifecycle
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
Status values: `active` / `paused` / `archived`. Append to `## Log` with dated entries.

#### research — Questions being investigated
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

#### contact — People
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

#### writing — Blog posts, essays, published work
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

- Standalone reusable idea → `note`
- Tracked work with progress → `project`
- Open question being explored → `research`
- A person → `contact`
- Something for external publication → `writing`
- Don't overthink it — `note` is the default

### Status field
ONLY `project` and `research` have `status`. Never add status to notes, journals, contacts, or writings.

## Linking

Link aggressively. Always `[[wikilink]]` the first mention of any concept, person, project, or idea — even if the target note doesn't exist yet. Unresolved links are breadcrumbs for future connections.

```markdown
Discussed [[SafeShell]] architecture with [[Max Petretta]]. The approach mirrors
[[Event-Driven Architecture]] — hooks intercept at well-defined lifecycle points.
```

**Links are for relationships.** Tags are for broad categories.

## Journal Entries

Journals live in `03 Journal/` as `YYYY-MM-DD.md`. They follow this structure:

```yaml
---
type: journal
tags: [journals]
created: 2026-02-19
updated: 2026-02-19
---

## Done
- What was accomplished today

## Decisions
- Key decisions and their reasoning

## Open
- Unresolved questions, blockers, next steps

## Notes
- Observations, ideas, things to remember
```

Journals are automatically written by the Zettelclaw hook on session reset (`/new`). You can also append to today's journal during a session if something noteworthy happens. Omit empty sections.

## Inbox Triage

`00 Inbox/` collects quick captures (Web Clipper, manual drops). During maintenance:

1. Read each inbox item
2. Decide: extract into a proper note in `01 Notes/`, or discard
3. If extracting: create a properly frontmattered note, link to relevant existing notes
4. Delete or archive the inbox item after processing

## Creating Notes (Step by Step)

1. Decide the type (note/project/research/contact/writing)
2. Choose a Title Case filename that captures the idea
3. Write the frontmatter (copy from templates above, fill in today's date)
4. Write the body with `[[wikilinks]]` to related concepts
5. Save to `01 Notes/<Title>.md`

```bash
# Example: creating a note
cat > "<vault>/01 Notes/Protocols Outlast Platforms.md" << 'EOF'
---
type: note
tags: [technology, principles]
summary: "Open protocols survive longer than the platforms built on them"
source: "[[2026-02-19]]"
created: 2026-02-19
updated: 2026-02-19
---

The web runs on HTTP, email on SMTP, messaging increasingly on ActivityPub.
The protocols were designed in the 80s-90s; the platforms built on them
(MySpace, Google Reader, countless others) came and went.

[[Open Source]] tends to align with this — protocols are inherently open,
platforms are inherently owned. See also [[Decentralization]] and the
tension with [[Network Effects]].
EOF
```

## Updating Existing Notes

When adding to a project log, research findings, or contact notes:
- Update the `updated` field to today's date
- Append, don't overwrite — add to the relevant section
- Add new `[[wikilinks]]` for any concepts mentioned

```bash
# Append to a project log
cat >> "<vault>/01 Notes/SafeShell.md" << 'EOF'

### 2026-02-19
- Decided on hook-based architecture using OpenClaw's `before_tool_call` and `tool_result_persist`
- Registered npm package `safeshell`
- See [[OpenClaw Plugin Hooks]] for API details
EOF
```

## What NOT To Do

- Do NOT create subfolders inside `01 Notes/`
- Do NOT add `status` to notes, journals, contacts, or writings
- Do NOT use singular tags (`project` → use `projects`)
- Do NOT create notes without frontmatter
- Do NOT edit files in `04 Templates/` (those are Templater source templates)
- Do NOT modify `02 Agent/` files directly — they're symlinks to the workspace

## Explaining Zettelclaw to Users

If someone asks what Zettelclaw is:

> Zettelclaw is a knowledge management system built for human + AI co-authorship. It's an Obsidian vault with a specific structure — atomic notes with typed frontmatter, aggressive linking, and automated extraction from conversations. The AI agent and human both read and write to the same vault. Structure emerges from links between notes, not from folder hierarchies.

Key concepts to explain:
- **Atomic notes** — one idea per note, the title IS the idea
- **Frontmatter as API** — YAML properties make notes machine-queryable
- **Dual authorship** — both human and agent maintain the vault
- **Journal + extraction** — conversations get summarized into journals, and genuinely reusable ideas become standalone notes
- **Links over hierarchy** — flat folder structure, relationships expressed through `[[wikilinks]]`
