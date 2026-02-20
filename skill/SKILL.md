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

## Authoring: Obsidian CLI vs File Tools

**Use Obsidian CLI** (`obsidian` command) when Obsidian is running — it resolves templates, updates the index, and handles properties natively.

**Fall back to file tools** (Read/Write/Edit) when Obsidian is not running or the CLI is unavailable.

To check if CLI is available:
```bash
obsidian version 2>/dev/null && echo "CLI available" || echo "CLI unavailable, use file tools"
```

## Searching the Vault

### Primary: memory_search
Use `memory_search` first — it indexes both the workspace and vault semantically.

### Obsidian CLI (structured, index-powered)
```bash
# Full-text search with match context
obsidian search query="search term" format=json matches

# Scoped to a folder
obsidian search query="hook architecture" path="01 Notes" format=json matches limit=10

# Find files by tag
obsidian tag name="projects"
obsidian tags all counts sort=count        # vault-wide tag overview

# Graph queries
obsidian backlinks path="01 Notes/SafeShell.md"     # what links TO this note
obsidian links path="01 Notes/SafeShell.md"         # what this note links TO
obsidian unresolved                                   # broken/unresolved links
obsidian orphans                                      # notes with no incoming links
```

### Fallback: grep/find (no Obsidian needed)
```bash
# Find by type
grep -rl 'type: project' "<vault>/01 Notes/"

# Active projects
grep -rl 'status: active' "<vault>/01 Notes/" | xargs grep -l 'type: project'

# Recent notes
find "<vault>/01 Notes/" -name "*.md" -mtime -7 | sort
```

## Creating Notes

### With Obsidian CLI (preferred)

Use `create` with `template=` and ALWAYS add `silent` to prevent Obsidian UI from opening:

```bash
# Create a note from template
obsidian create name="Protocols Outlast Platforms" template=note silent

# Create a project
obsidian create name="SafeShell" template=project silent

# Create a research note
obsidian create name="Hook Architecture Patterns" template=research silent

# Create a contact
obsidian create name="Max Petretta" template=contact silent

# Create a writing
obsidian create name="Why Agents Need Knowledge Systems" template=writing silent
```

Then fill in the content and set properties:

```bash
# Set properties
obsidian property:set name=summary value="Open protocols survive longer than platforms" path="01 Notes/Protocols Outlast Platforms.md"
obsidian property:set name=tags value="technology,principles" path="01 Notes/Protocols Outlast Platforms.md"
obsidian property:set name=source value="[[2026-02-19]]" path="01 Notes/Protocols Outlast Platforms.md"

# Add body content
obsidian append path="01 Notes/Protocols Outlast Platforms.md" content="The web runs on HTTP, email on SMTP. The protocols were designed in the 80s-90s; the platforms built on them came and went.\n\nSee also [[Open Source]] and [[Network Effects]]."
```

**Gotchas:**
- `create` without `silent` opens Obsidian UI — ALWAYS add `silent`
- `create` with `template=` may place the file in the template's configured folder, not where you expect. Verify with `obsidian search` after creation.
- `create` doesn't auto-create directories — use `mkdir -p` first if needed
- `create` without `overwrite` is safe (won't replace existing files)
- Exit code 0 doesn't guarantee success — check output for "Error:" strings

### With File Tools (fallback)

When Obsidian CLI is unavailable, write files directly:

```bash
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

### Frontmatter Rules (for file tool fallback)
- Every note MUST have YAML frontmatter with at least `type`, `created`, `updated`
- Tags are ALWAYS pluralized (`projects` not `project`)
- Dates are ALWAYS `YYYY-MM-DD`
- Filenames are Title Case (`React Virtual DOM Trades Memory For Speed.md`)

## Note Types

### note — Atomic ideas and knowledge
```yaml
type: note
tags: []
summary: "One-line description"
source: ""
```
The body is the explanation. No prescribed sections. Link profusely.

### project — Tracked work with a lifecycle
```yaml
type: project
status: active        # active / paused / archived
tags: []
aliases: []
summary: "What this project is"
```
Sections: `## Goal`, `## Log`. Append dated entries to Log.

### research — Questions being investigated
```yaml
type: research
status: active        # active / archived
tags: []
summary: "What we're investigating"
source: ""
```
Sections: `## Question`, `## Findings`, `## Conclusion`, `## Sources`

### contact — People
```yaml
type: contact
tags: [contacts]      # always include "contacts"
aliases: []
summary: "Who this person is"
```
Sections: `## Context`, `## Notes`

### writing — Blog posts, essays, published work
```yaml
type: writing
tags: []
summary: "What this piece is about"
source: ""
published: ""         # URL once posted, empty = draft
```

### Which type to use?
- Standalone reusable idea → `note`
- Tracked work with progress → `project`
- Open question being explored → `research`
- A person → `contact`
- Something for external publication → `writing`
- Don't overthink it — `note` is the default

### Status field
ONLY `project` and `research` have `status`. Never add status to notes, journals, contacts, or writings.

## Updating Existing Notes

### With Obsidian CLI
```bash
# Append to a file
obsidian append path="01 Notes/SafeShell.md" content="\n### 2026-02-19\n- Decided on hook-based architecture\n- See [[OpenClaw Plugin Hooks]]"

# Update a property
obsidian property:set name=status value=paused path="01 Notes/SafeShell.md"
obsidian property:set name=updated value=2026-02-19 path="01 Notes/SafeShell.md"

# Read a file
obsidian read path="01 Notes/SafeShell.md"

# Read a specific property
obsidian property:read name=status path="01 Notes/SafeShell.md"
```

### With File Tools
- Update the `updated` field to today's date
- Append, don't overwrite — add to the relevant section
- Add new `[[wikilinks]]` for any concepts mentioned

## Journal Entries

Journals live in `03 Journal/` as `YYYY-MM-DD.md`:

```yaml
type: journal
tags: [journals]
```
Sections: `## Done`, `## Decisions`, `## Open`, `## Notes`

Journals are automatically written by the Zettelclaw hook on session reset. You can also append during a session:

```bash
# With CLI
obsidian append path="03 Journal/2026-02-19.md" content="\n- Discovered Obsidian 1.12 CLI supports template creation"

# Or use daily note commands if Journal is configured as the daily notes folder
obsidian daily:append content="- Discovered Obsidian 1.12 CLI supports template creation"
```

## Linking

Link aggressively. Always `[[wikilink]]` the first mention of any concept, person, project, or idea — even if the target note doesn't exist yet.

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
4. Delete or archive the inbox item after processing

```bash
# List inbox items
obsidian files folder="00 Inbox" ext=md

# Read an inbox item
obsidian read path="00 Inbox/Captured Article.md"

# After processing, delete the inbox item (moves to trash)
obsidian delete path="00 Inbox/Captured Article.md"
```

## Vault Maintenance

Useful commands for periodic maintenance:

```bash
# Find unresolved links (notes referenced but not yet created)
obsidian unresolved

# Find orphan notes (no incoming links)
obsidian orphans

# Find deadend notes (no outgoing links)
obsidian deadends

# Tag overview
obsidian tags all counts sort=count

# List all vault files
obsidian files ext=md

# Check vault health
obsidian vault
```

## What NOT To Do

- Do NOT create new directories or subfolders — EVER — unless the user explicitly asks. The vault structure is fixed.
- Do NOT add `status` to notes, journals, contacts, or writings
- Do NOT use singular tags (`project` → use `projects`)
- Do NOT create notes without frontmatter
- Do NOT edit files in `04 Templates/` (those are Templater source templates)
- Do NOT modify `02 Agent/` files directly — they're symlinks to the workspace
- Do NOT use `obsidian create` without `silent` — it opens the UI
- Do NOT trust exit codes from the Obsidian CLI — check output for "Error:" strings

## Explaining Zettelclaw to Users

If someone asks what Zettelclaw is:

> Zettelclaw is a knowledge management system built for human + AI co-authorship. It's an Obsidian vault with a specific structure — atomic notes with typed frontmatter, aggressive linking, and automated extraction from conversations. The AI agent and human both read and write to the same vault. Structure emerges from links between notes, not from folder hierarchies.

Key concepts:
- **Atomic notes** — one idea per note, the title IS the idea
- **Frontmatter as API** — YAML properties make notes machine-queryable
- **Dual authorship** — both human and agent maintain the vault
- **Journal + extraction** — conversations get summarized into journals, reusable ideas become standalone notes
- **Links over hierarchy** — flat structure, relationships via `[[wikilinks]]`
- **Two authoring paths** — humans use Obsidian + Templater, agents use Obsidian CLI or file tools. Same templates, same vault.
