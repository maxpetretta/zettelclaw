# Zettelclaw Vault Specification

> The canonical reference for the Zettelclaw vault system. Describes the philosophy, structure, conventions, and agent integration patterns that define how the vault works.

## Table of Contents

- [What Zettelclaw Is](#what-zettelclaw-is)
- [Philosophy](#philosophy)
- [Methodology Inspirations](#methodology-inspirations)
- [Folder Structure](#folder-structure)
- [Note Types](#note-types)
- [Frontmatter Schema](#frontmatter-schema)
- [Tags](#tags)
- [Linking](#linking)
- [Content Ingestion](#content-ingestion)
- [The Inbox Pipeline](#the-inbox-pipeline)
- [Bases Views](#bases-views)
- [Agent Integration](#agent-integration)
- [Templates](#templates)
- [Obsidian Configuration](#obsidian-configuration)
- [QMD Search](#qmd-search)

---

## What Zettelclaw Is

Zettelclaw is an opinionated Obsidian vault template designed for a specific workflow: **capture content you consume, write your thinking about it, and let an AI agent help you navigate and connect what you've written.**

The vault is the shared medium between human and agent. The human writes notes. The agent reads, searches, and surfaces insights from them. The system is optimized for this division of labor — every convention exists to make the vault legible to both parties with minimal friction.

Zettelclaw is not a general-purpose knowledge management system. It is built for one person's thinking practice, augmented by an AI assistant.

---

## Philosophy

### Human writes, agent reads

The vault is the human's externalized thinking. The agent is a reader, navigator, and synthesizer — not a ghostwriter. The human writes content. The agent reads it and surfaces connections, contradictions, and suggestions.

This principle is grounded in the deepest claims of the methodologies Zettelclaw draws from. Luhmann described his slip-box as a "communication partner" that surprised him — but he wrote every card himself. Matuschak argues that "better note-taking misses the point; what matters is better thinking" — and thinking happens through writing. An agent that writes your notes for you defeats the purpose. An agent that reads your notes and tells you what you forgot, what contradicts what, and what connects to what — that's the tool.

The agent has a controlled write surface: daily note scaffolding (operational) and `/ask` responses (conversational). These are ephemeral or operational — never permanent knowledge. The human writes knowledge.

### Simplicity as virtue

No more structure than is absolutely necessary. Every convention, property, template, and folder must earn its place. If something can be a tag instead of a property, it's a tag. If a note type can be an evergreen note with a tag, it doesn't get its own type. If a feature requires a plugin, it must justify the dependency.

The vault should be understandable in five minutes and usable in one.

### Atomic notes

One idea per note. If a note covers multiple concepts, it should be split. Atomic notes produce clean search results, reliable embeddings, and focused context for the agent. The title should capture the idea completely — a reader (human or agent) should be able to reason about the note from its title alone without reading the body.

### Titles as APIs

A note's title is its interface. Use complete, declarative phrases: "Spaced Repetition Works Because of Retrieval," not "Spaced Repetition." A well-titled note can be linked by title alone and understood without opening it. This is the single most valuable principle for agent navigation — the agent can reason about the vault at the title level.

### Dense linking

Link aggressively. First mentions of a concept should be linked, even if the target note doesn't exist yet. Unresolved links (`[[Concept I Haven't Written About]]`) are breadcrumbs — they signal that a concept matters and that it connects to the current note. Over time, stubs accumulate into a map of your interests that the agent can surface: "You've linked to [[Retrieval Practice]] from 7 notes but never written it."

Links are how the vault becomes a graph rather than a folder of files. The agent traverses links for context. Dense linking creates richer traversal.

---

## Methodology Inspirations

Zettelclaw draws from several knowledge management methodologies, adopting specific concepts rather than any system wholesale.

### What we adopted

| Concept | Source | Why |
|---|---|---|
| **Atomic notes** | Zettelkasten, Evergreen Notes | Clean search results, reliable embeddings, focused agent context |
| **Titles as APIs** | Evergreen Notes (Matuschak) | Agent reasons at the title level. Most valuable single principle |
| **Content-typed notes** | Zettelkasten | Distinct types (note, article, book, youtube, etc.) make the vault's contents immediately legible to agents |
| **Dense, contextual linking** | Zettelkasten, Evergreen Notes | Graph traversal for multi-hop context. Links include *why* the connection exists |
| **Source/thinking separation** | Zettelkasten | Source notes (what others said) vs. evergreen notes (what you think) |
| **Inbox as universal capture** | GTD | Everything enters unsorted. Process or discard on a regular cadence |
| **Stubs as breadcrumbs** | Evergreen Notes (Matuschak), Steph Ango | Unresolved links signal future notes. The agent surfaces them |
| **Accretion principle** | Evergreen Notes | Each interaction with the vault should leave it slightly better |

### What we skipped

| Concept | Source | Why skip |
|---|---|---|
| **Maps of Content (MOCs)** | LYT | Agent + QMD search replaces navigational structure. MOCs are human-maintained indexes — the agent is the index |
| **Home Note** | LYT | No single root needed. The agent searches the full vault |
| **PARA's four-box structure** | PARA | Folder siloing is worse for agents than humans. Use links + metadata instead |
| **Deep folder hierarchies** | PARA, Johnny.Decimal | Flat is better for agents. Links over folders |
| **Johnny.Decimal numbering** | Johnny.Decimal | Too rigid for emergent knowledge growth |
| **Progressive Summarization layers** | Forte | Bold vs. highlight is meaningless to an agent reading markdown |
| **Fractal journaling rollups** | Steph Ango | On-demand agent synthesis replaces pre-built weekly/monthly rollups |
| **Context tags (@computer, @phone)** | GTD | Not relevant to a thinking-focused vault |
| **Epistemic status** | Gwern | Adds complexity without clear agent value. Note quality is evident from the content |
| **Note maturity stages** | Digital Gardens | Seedling/budding/evergreen tracking is maintenance burden. A note is either written or it isn't |

### The principle behind the choices

Every adopted concept serves agent navigation or reduces human friction. Every skipped concept either adds structure the agent doesn't need, or creates maintenance burden the system can avoid.

---

## Folder Structure

```
<vault>/
├── 00 Inbox/          # Raw captures. Web Clipper drops here. Process or discard.
├── 01 Notes/          # All durable notes, content, and docs.
├── 02 Journal/        # Daily notes (YYYY-MM-DD.md).
├── 03 Templates/      # Core note templates + Web Clipper JSON.
├── 04 Attachments/    # Images, PDFs, files.
├── AGENTS.md          # Agent orientation document (see Agent Integration).
└── README.md          # Human-facing vault welcome.
```

Five folders. No subfolders within the main note areas. Notes are organized by links and metadata, not by folder hierarchy.

### Folder semantics

| Folder | What goes in | What comes out |
|---|---|---|
| **00 Inbox** | Everything captured via Web Clipper. Unprocessed, unsorted. | Promoted to 01 Notes, processed into notes, or discarded. |
| **01 Notes** | All durable notes — your thinking, consumed content, tracked work. | Nothing. Notes live here permanently. |
| **02 Journal** | One note per day, named `YYYY-MM-DD.md`. | Nothing. Journal entries accumulate. |
| **03 Templates** | Templates plugin `.md` templates and Web Clipper `.json` templates. | Used by Templates/Daily Notes and Web Clipper. |
| **04 Attachments** | Images, PDFs, and other files embedded in notes. | Referenced via `![[file]]` embeds. |

---

## Note Types

Two categories of types: **notes** (your thinking), and **content types** (things you consume). Plus **doc** (non-atomic catch-all) and **journal** (daily logs).

### Note

Your thinking. The core of the vault. One atomic idea, written in your own words, titled as an API.

```yaml
---
type: note
tags: [learning, memory]
created: 2026-03-04
---
```

Notes have no `status`. A note is either written or it isn't. There's no maturity tracking — the content speaks for itself. If a note is rough, you'll know when you read it.

**When to create:** When you have an original thought, insight, or synthesis provoked by something you read, experienced, or discussed. The note captures *your* thinking, not the source material.

### Content types

Things you consume from outside the vault. Each content type gets its own `type` value so Bases can filter and display them naturally.

| Type | What it is | Typical source |
|---|---|---|
| `article` | Blog posts, news articles, essays, newsletters | Web Clipper |
| `book` | Books (physical or digital) | Manual creation |
| `movie` | Films | Manual creation |
| `tv` | TV series | Manual creation |
| `youtube` | YouTube videos | Web Clipper |
| `tweet` | Tweets and threads | Web Clipper |
| `podcast` | Podcast episodes | Manual creation |
| `paper` | Academic papers, preprints | Web Clipper |

```yaml
---
type: article
status: queued
tags: [ai, transformers]
author: Vaswani et al.
source: https://arxiv.org/abs/1706.03762
created: 2026-03-04
---
```

New content types can be added as needed — just use a new `type` value. No schema change required.

**The source/thinking separation:** Content notes record what others said. Notes record what you think. When you consume a source and have an insight, create a note (`type: note`) and link it back to the content. The content is the reference; your note is the knowledge.

### Doc

The catch-all for non-atomic content. Meeting notes, project plans, trip logs, reference pages — anything naturally multi-section that doesn't reduce to one idea.

```yaml
---
type: doc
status: in-progress
tags: [zettelclaw]
created: 2026-03-04
---
```

Docs use `status` because they have a lifecycle — you're drafting, writing, or done.

### Journal

Daily logs. One per day, named `YYYY-MM-DD.md`. Captures what happened, what you decided, what you learned. Ephemeral by nature — individual entries aren't meant to be durable, but the archive is valuable for temporal queries ("what was I working on in February?").

```yaml
---
type: journal
tags: []
created: 2026-03-04
---
```

Journal notes don't use `status`.

### What about contacts, writing, research?

These are notes or docs with descriptive tags, not separate types. A note about a person is `type: note` with `tags: [people]`. A research question is `type: note` with `tags: [research]`. A project plan is `type: doc` with `tags: [project, zettelclaw]`. Fewer types means fewer templates, fewer schemas, and less cognitive overhead.

### Status

A single, unified set of status values used across all content types and docs:

`queued` → `in-progress` → `done` → `archived`

| Status | Meaning |
|---|---|
| `queued` | Saved for later. On the reading list, watch list, or doc backlog. |
| `in-progress` | Currently consuming or working on. |
| `done` | Finished reading, watching, or completed. |
| `archived` | Done and no longer actively relevant. Kept for reference. |

Not every type uses every status. A tweet might go `queued → done` without an `in-progress` step. That's fine — skip what doesn't apply.

**Notes and journal entries don't use status.** They have no lifecycle — they exist.

---

## Frontmatter Schema

### Universal properties (all notes)

| Property | Type | Required | Description |
|---|---|---|---|
| `type` | text | yes | `note`, `doc`, `article`, `book`, `movie`, `youtube`, `tweet`, `journal`, etc. |
| `status` | text | varies | `queued`, `in-progress`, `done`, `archived`. Used by content types and docs. Omitted for `note` and `journal`. |
| `tags` | list | yes | Topic and domain classification. Array format: `[learning, memory]` |
| `created` | date | yes | `YYYY-MM-DD`. Set once at creation. |

### Content-only properties

| Property | Type | Required | Description |
|---|---|---|---|
| `author` | text | no | Creator of the source content |
| `source` | text | no | URL or reference identifier |

### Properties we deliberately omit

| Property | Why omit |
|---|---|
| `updated` | `file.mtime` handles this. No manual maintenance needed. |
| `summary` | Not needed. The note content speaks for itself. |
| `up` | No MOCs. No upward navigation needed. |
| `aliases` | Use when needed on specific notes, not as a default field. |
| `priority` | Use tags if needed: `tags: [priority/high]`. |
| `confidence` | Note quality is evident from the content. No maturity tracking needed. |
| `queue` | Replaced by `status`. A source with `status: queued` is a queue item. |

### Design rationale

`type` and `status` are frontmatter properties (not tags) because Bases needs to group by them, sort by them, and support inline editing. Tags are for topic/domain classification — the flexible, multi-dimensional layer you can extend without schema changes.

The total schema is **four universal properties** and **two optional content properties**. This is the minimum viable set for the system to function.

---

## Tags

Tags live in the frontmatter `tags` array. Not inline in the note body — the body is pure content.

```yaml
tags: [learning, memory, spaced-repetition]
```

### What tags are for

Tags classify notes by topic and domain. They answer "what is this note about?" while `type` answers "what kind of note is this?" and `status` answers "what state is it in?"

### Nesting

Use nested tags when a hierarchy is genuinely useful:

```yaml
tags: [ai, ai/transformers, ai/scaling-laws]
```

The parent tag (`ai`) is queryable independently of the child (`ai/transformers`). Don't over-nest — `ai/transformers` is useful, `ai/deep-learning/architectures/attention/transformers` is not.

### Tag conventions

- Lowercase, hyphenated: `spaced-repetition`, not `Spaced Repetition` or `spacedRepetition`
- Topic-oriented, not structural: `learning` (what it's about), not `important` (how you feel about it)
- Add tags at creation time. The Web Clipper and templates pre-populate them.
- The agent can suggest tags based on note content and existing vault taxonomy.

### How tags work with Bases

Bases filter on tags using `file.hasTag("tag-name")`. This supports nested tags. You can build a Base view that shows all notes tagged `ai` regardless of whether they're `ai`, `ai/transformers`, or `ai/scaling-laws`.

Tags cannot be used as sortable or groupable columns in Bases directly. For fields you need to sort, group, or inline-edit — use a frontmatter property (`type`, `status`). For fields you need to filter — tags work.

---

## Linking

### Principles

1. **Link on first mention.** When you reference a concept, link it: `[[Retrieval Practice]]`.
2. **Link to stubs.** If the target note doesn't exist, link anyway. Stubs are breadcrumbs. The agent can surface: "You've linked to [[Concept X]] from 5 notes but never written it."
3. **Link inline, in context.** Place links where the connection is natural in your prose — that's where they carry the most meaning. No dedicated Related section needed; the note body *is* the relationship map.
4. **Prefer wikilinks over URLs.** Internal connections use `[[wikilinks]]`. External references go in the `source` property or as markdown links in the body.

---

## Content Ingestion

### Web Clipper

The Obsidian Web Clipper is the primary way to get external content into the vault. It creates source notes in `00 Inbox/` with pre-populated frontmatter.

The clipper template (`03 Templates/clipper-capture.json`) creates notes with:
- `type:` set by content type (`article`, `youtube`, `tweet`, etc.)
- `status: queued`
- `source:` the URL
- `author:` extracted from the page
- `tags:` based on content classification
- `created:` capture date

The note body contains the captured content — article text, tweet text, video metadata — plus a summary section.

### What the clipper captures

Any web content: articles, blog posts, tweets, YouTube videos, research papers, documentation pages. The clipper uses URL-based triggers to set the correct `type` — Tweet URLs (x.com, twitter.com) become `type: tweet`, YouTube URLs become `type: youtube`, everything else becomes `type: article`.

### Manual capture

For content that isn't on the web — books, movies, podcasts, talks — create a content note manually in `01 Notes/` with the appropriate type (`type: book`, `type: movie`, etc.).

---

## The Inbox Pipeline

The inbox is a processing queue, not a storage location.

### The flow

```
Web Clipper → 00 Inbox/ (status: queued)
                  │
                  ▼
         You process the inbox
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
    Keep in     Write a     Discard
    queue       note        the capture
```

**Keep in queue:** The content stays with `status: queued`. Move it from `00 Inbox/` to `01 Notes/`. It appears in the relevant Bases queue view (reading queue, watch queue, etc.) based on its `type`.

**Write a note:** Read the source, create a new note (`type: note`) in `01 Notes/` with your thinking, link it back to the source with `[[Source Title]]`. The source can stay or be discarded.

**Discard:** Delete the capture. Not everything you clip deserves a note. The URL still exists on the internet if you ever want it again.

### Processing cadence

Empty the inbox regularly. The system degrades when the inbox accumulates hundreds of unprocessed items. How often is personal — daily, weekly, or whenever it feels full. The point is: captured items are temporary. They become notes or they disappear.

### Agent role in inbox processing

The agent does not pre-generate notes from inbox items. That violates human-writes.

What the agent *can* do when you're processing inbox:
- Search the vault for existing notes related to the captured content
- Suggest tags based on your existing taxonomy
- Identify which of your notes the source supports or contradicts

These are all read-and-surface operations. The agent annotates; the human decides.

---

## Bases Views

Bases replace Dataview for all structured views of vault content. Bases are `.base` files (YAML) that query frontmatter properties and file metadata. They're writable by agents, queryable via CLI, and support inline editing.

### Inbox

The one Base view included with the vault (`00 Inbox/inbox.base`):

```yaml
filters:
  and:
    - file.inFolder("00 Inbox")
    - 'file.ext == "md"'

views:
  - type: table
    name: "Inbox"
    groupBy:
      property: note.type
      direction: ASC
    order:
      - file.name
      - type
      - status
      - author
      - source
      - created
```

### Creating more views

Add `.base` files as needed — reading queues, watch lists, content by type. The agent can create these for you. Example prompt: "Create a Base view showing all my unread articles."

### Why Bases over Dataview

- Bases are first-party Obsidian (actively developed, not a community plugin)
- `.base` files are YAML — agents write them trivially
- Bases support inline editing — click a `status` cell to change it
- Bases are queryable via the Obsidian CLI (`obsidian base:query`)
- Dataview uses a bespoke query language agents frequently get wrong

---

## Agent Integration

### AGENTS.md

The vault root contains `AGENTS.md` — the orientation document for any terminal-based agent (Claude Code, Codex, OpenCode, etc.) working in the vault directory.
For Claude compatibility, `CLAUDE.md` is an alias of `AGENTS.md` in the template vault.

`AGENTS.md` teaches the agent:
- The vault's folder structure and what each folder contains
- The note types and their frontmatter schemas
- The tagging convention
- The linking convention (dense, stubs encouraged, annotated Related sections)
- What the agent should and should not do
- How to search the vault (QMD commands, or ripgrep fallback)
- Where templates live

`AGENTS.md` is the vault-level equivalent of a project's `CLAUDE.md`. It's read once at session start and provides full context for the agent to operate.

### What the agent does

**Navigation and retrieval:**
- Search the vault for notes relevant to a question (QMD or ripgrep)
- Traverse wikilinks to follow connections between notes
- Read frontmatter to understand note type, status, and topic
- Surface notes the human forgot about

**Synthesis and surfacing:**
- Identify connections between notes the human hasn't linked
- Find contradictions between notes written at different times
- Surface orphan notes (unlinked, no Related section)
- Surface stubs that have accumulated many inbound links
- Answer questions about vault content (via `/ask` or terminal)

**Operational writing (the controlled write surface):**
- Daily note scaffolding — events, todos, open PRs, market data. Ephemeral by nature
- `/ask` responses — conversational, in response to explicit human questions

**Maintenance (with human review):**
- Suggest tags for new notes based on existing taxonomy
- Flag notes that violate atomicity (multiple concepts)
- Flag notes that may be stale
- Validate frontmatter consistency
- Suggest links between unlinked notes

### What the agent does not do

- Write notes from scratch
- Decide what the human thinks about a topic
- Assign or change `status` without being asked
- Delete notes
- Create notes in `01 Notes/` without explicit instruction
- Move notes between folders without explicit instruction
- Modify the human's prose content

### Daily note generation

Journal notes use a minimal template (frontmatter only). If the agent generates daily operational context, it appends a briefing callout after frontmatter — it does not add fixed section headings.

```markdown
---
type: journal
tags: []
created: 2026-03-04
---

> [!agent]- Daily briefing · 2026-03-04
> - 3 calendar events today
> - 2 open PRs awaiting review
> - Market: S&P 500 +0.3% pre-market
> - Inbox: 5 unprocessed captures
```

The `[!agent]` callout is operational and ephemeral; durable content comes from the human's journal writing.

### The /ask protocol

The `/ask` system (inline questions answered by the agent within notes) is specified separately and is not part of the core Zettelclaw vault. It is a general-purpose tool — any markdown vault + any agent CLI can use it. See `docs/ask-command-spec.md` for the full specification.

The callout protocol:
- `> [!ask]` — human's question (agent never modifies)
- `> [!agent]- Processing...` — temporary placeholder while a response is running
- `> [!agent]- YYYY-MM-DD · agent-name · N sources` — completed response title line (collapsed by default)
- The agent callout is inserted immediately after the ask callout, separated by one blank line

---

## Templates

Two note templates plus one Web Clipper template. Content types (article, book, movie, etc.) don't need templates — the clipper handles them, or you create them manually with the right `type` value.

### Note template (`03 Templates/note.md`)

```markdown
---
type: note
tags: []
created: {{date:YYYY-MM-DD}}
---
```

### Journal template (`03 Templates/journal.md`)

```markdown
---
type: journal
tags: []
created: {{date:YYYY-MM-DD}}
---
```

### Web Clipper template (`03 Templates/clipper-capture.json`)

Creates content notes in `00 Inbox/` with:
- `type:` set by URL (`tweet`, `youtube`, or `article`)
- `status: queued`
- `source:` the page URL
- `author:` extracted from page metadata
- `tags:` content-based classification
- `created:` capture date

A single universal template handles all content types. URL triggers set the `type` value automatically.

---

## Obsidian Configuration

### Required plugins

| Plugin | Purpose |
|---|---|
| **Calendar** | Date navigation and daily-note browsing in the sidebar. |

### Optional plugins (installer presets)

| Plugin | Purpose |
|---|---|
| **Obsidian Git** | Git-based sync workflow (enabled when sync mode is `git`). |
| **Obsidian Minimal Settings** | Minimal theme customization preset. |
| **Obsidian Hider** | UI controls used by the minimal preset (`hideVault: false`). |

### Removed dependencies

| Plugin | Why removed |
|---|---|
| **Dataview** | Replaced by Bases. Bases are first-party, YAML-native, and agent-writable. |
| **Templater** | Default templates use core date variables (`{{date:YYYY-MM-DD}}`). |
| **Obsidian Linter** | `created` is set at template insertion time; no YAML mutation plugin required. |

### Settings

| Setting | Value |
|---|---|
| Default new note location | `01 Notes` |
| Attachment folder | `04 Attachments` |
| Daily notes folder | `02 Journal` |
| Daily notes format | `YYYY-MM-DD` |
| Daily notes template | `03 Templates/journal.md` |
| Templates folder | `03 Templates` |
| Properties in document | `source` |
| Backlinks in document | `false` |
| Right sidebar default panes | Calendar, Backlinks, Outgoing links, Outline |

---

## QMD Search

[QMD](https://github.com/tobi/qmd) is the recommended search engine for agent access to the vault. It indexes markdown files locally and provides keyword (BM25), semantic (vector embeddings), and hybrid search.

### Collections

`zettelclaw init` creates one QMD collection per vault folder:

```
zettelclaw-<vault>-inbox
zettelclaw-<vault>-notes
zettelclaw-<vault>-journal
```

Templates and Attachments are not indexed.

### Search commands

```bash
# Hybrid search (best quality — keyword + semantic + reranking)
qmd query "spaced repetition and retrieval" -c zettelclaw-vault-notes

# Keyword search (fast, exact terms)
qmd search "type: source" -c zettelclaw-vault-inbox

# Semantic search (conceptual similarity)
qmd vsearch "what makes learning stick" -c zettelclaw-vault-notes
```

### Fallback

When QMD is not installed, the agent falls back to ripgrep:

```bash
rg -l 'type: note' "01 Notes/"
rg -l 'type: article' "01 Notes/"
rg -l 'status: queued' "01 Notes/"
```

Degraded but functional. QMD provides relevance-ranked results; ripgrep provides file-level matches.
