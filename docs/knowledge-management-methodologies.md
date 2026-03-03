# Knowledge Management Methodologies for AI-Optimized Vaults

> Research compiled March 2026. Surveys major PKM methodologies and evaluates which concepts are most useful for building an Obsidian vault template designed to work with AI assistants.

## Table of Contents

- [Overview](#overview)
- [Zettelkasten](#zettelkasten)
- [Linking Your Thinking (LYT)](#linking-your-thinking-lyt)
- [Evergreen Notes](#evergreen-notes)
- [PARA](#para)
- [GTD (Getting Things Done)](#gtd-getting-things-done)
- [Progressive Summarization](#progressive-summarization)
- [Digital Gardens](#digital-gardens)
- [Cornell Note-Taking](#cornell-note-taking)
- [Johnny.Decimal](#johnnydecimal)
- [Synthesis: What to Adopt for an AI-Native Vault](#synthesis-what-to-adopt-for-an-ai-native-vault)

---

## Overview

No single methodology covers everything a vault needs. The methodologies fall into three functional layers:

| Layer | Purpose | Best methodologies |
|---|---|---|
| **Thinking** | Develop ideas, create knowledge | Zettelkasten, Evergreen Notes, LYT |
| **Organizing** | Structure and navigate information | PARA, LYT (MOCs), Johnny.Decimal |
| **Acting** | Manage tasks and projects | GTD, PARA (Projects) |

The question isn't "which one?" — it's "which concepts from each serve an AI agent best?"

---

## Zettelkasten

**Origin:** Niklas Luhmann (1927–1998), German sociologist. 90,000 handwritten index cards → 50+ books, 600 articles. Popularized by Sönke Ahrens in *How to Take Smart Notes* (2017).

### Core Principles

- **Atomicity.** One idea per note. If you can't express it on a single card, you don't understand it yet.
- **Unique identifiers.** Every note gets a permanent address. Luhmann used branching alphanumeric IDs (`1`, `1a`, `1a1`). Digital implementations use timestamps (`202603031045`) or title-based wikilinks.
- **Linking over filing.** Notes connect to each other via explicit links with context about *why* the connection exists. The link network is the structure — not folders.
- **Two separate boxes.** Bibliographic references (source metadata) are kept separate from the main slip-box (your own thinking). Source material stays distinct from original thought.
- **Structure notes.** Meta-notes that organize other notes into sequences or hierarchies, functioning as navigational hubs across the graph.

### Note Types (Ahrens)

| Type | Purpose | Lifespan |
|---|---|---|
| **Fleeting** | Quick captures while busy | Temporary — process or discard within 1–2 days |
| **Literature** | Source info + brief commentary in your own words | Permanent reference |
| **Permanent (Zettels)** | Self-contained ideas, written "as if for print" | Permanent — the core of the system |
| **Project** | Notes relevant only to a specific project | Discarded/archived after project ends |

### Obsidian Implementation

- Most practitioners use a flat or near-flat folder structure — no subfolders within the main Zettelkasten
- `[[wikilinks]]` as the primary linking mechanism, with backlinks panel for reverse navigation
- Tags used sparingly (note type: `#zettel`, `#moc`, `#fleeting`) rather than for topics
- Maps of Content (MOCs) serve as digital structure notes
- Minimal plugins: core Obsidian features (wikilinks, backlinks, graph view) are sufficient

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Atomicity** | One idea per note = clean embeddings, reliable RAG chunks, less noise in context windows |
| **Self-contained notes** | Agent can understand a note without reading surrounding files |
| **Explicit link context** | Agent knows not just *what* connects but *why* — enables multi-hop reasoning |
| **Structure notes as navigation** | Agent reads a hub note to orient itself in a topic cluster |
| **Source/thinking separation** | Agent can distinguish referenced facts from user's interpretations |
| **Flat structure** | No folder hierarchy to navigate — graph traversal via links instead |

**Key limitation:** High time cost per note. The agent can absorb much of this overhead — converting raw captures into properly formatted Zettels, suggesting links, identifying gaps.

---

## Linking Your Thinking (LYT)

**Origin:** Nick Milo. The most popular Obsidian-native methodology. The Ideaverse starter kit has been downloaded 70,000+ times.

### Core Concepts

**Maps of Content (MOCs)** — Higher-order notes whose content is primarily curated, annotated links to other notes. Key properties:
- Non-destructive overlays: deleting a MOC doesn't touch the linked notes
- A note can appear in multiple MOCs (unlike folders)
- Created when you hit a "Mental Squeeze Point" — too many related notes to hold in working memory
- Three-phase creation: **Dump** (collect links), **Lump** (group and annotate), **Jump** (revisit and refine)

**Home Note** — Single highest-level entry point. A MOC of MOCs — links to all top-level topic maps. Your launchpad and homebase.

**ACE Folder Structure** — Three folders mapping to dimensions of recall:

| Folder | Dimension | Contents |
|---|---|---|
| **Atlas** | Space (knowledge) | Concept notes, source notes, maps, references |
| **Calendar** | Time | Daily notes, journals, periodic reviews |
| **Efforts** | Importance (action) | Projects, areas of focus, active goals |

Plus utility folders: `+` (Inbox) and `x` (Extra — templates, scripts, images).

**Idea Emergence** — Five levels of increasing complexity:
1. **Note** — A thought externalized
2. **Link** — Notes connect to each other
3. **MOC** — A navigational map emerges at a Mental Squeeze Point
4. **MOC Network** — MOCs link to other MOCs, forming ecosystems
5. **Home Note** — The top-level consolidation point

### How LYT Differs from Zettelkasten

| Aspect | Zettelkasten | LYT |
|---|---|---|
| Primary purpose | Writing tool — produce published output | Sensemaking — personal orientation |
| Atomicity | Strict from the start | Relaxed — emerges through linking |
| Note creation friction | High ("eufriction") | Low — capture freely, link later |
| Structure notes | Record existing connections | MOCs actively *forge* new connections |
| Required output | Writing is the point | Output is optional |

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **MOCs as entry points** | Agent reads a MOC to understand the landscape of a topic without searching 1,000 notes |
| **Home Note as root** | Single known starting point for graph traversal — like a sitemap |
| **`up:` link convention** | If every note has an `up:` frontmatter field, the agent can always navigate upward to understand context |
| **ACE folder semantics** | Atlas = knowledge, Calendar = temporal context, Efforts = active priorities — agent scopes search by folder |
| **Mental Squeeze Point as trigger** | Agent detects when a cluster of 20+ related notes lacks a MOC and suggests creating one |
| **Non-destructive overlays** | Agent can safely create/modify/delete MOCs without risking data loss |

---

## Evergreen Notes

**Origin:** Andy Matuschak (ex-Apple, ex-Khan Academy). His [working notes](https://notes.andymatuschak.org/) are themselves a public evergreen note system.

### Core Principles

1. **Atomic** — One concept per note, completable in under 30 minutes
2. **Concept-oriented** — Organized by idea, not by source/author/project. Ask: "In which context will I want to stumble upon this again?"
3. **Densely linked** — Links promote expansive thinking, deepen internalization, enable organic spaced repetition, and create multiple navigation paths
4. **Associative over hierarchical** — Prefer link-based networks over folder taxonomies. Ideas belong across multiple categories simultaneously
5. **Titles are like APIs** — A well-titled note can be referenced by title alone. Use complete, declarative phrases: "A company is a superorganism," "Writing is telepathy"

### The Accretion Principle

"Knowledge work should accrete." Most knowledge work produces ephemeral outputs (emails, meetings, conversations). The system should yield compounding returns. Matuschak proposes that the number of evergreen notes written per day may be the leading indicator of knowledge worker productivity.

### Note Maturity Taxonomy

| Level | Type | Description |
|---|---|---|
| 1 | Ephemeral scratchings | Thoughts in a daily log. Temporary. |
| 2 | Writing inbox items | Prompts that may become evergreen notes |
| 3a | Stubs | Implicitly defined through backlinks |
| 3b | Simple definitions | Terms of art, minimal interpretation |
| 3c | Bridge notes | Connect adjacent concepts |
| 3d | Declarative notes | Sharp, focused claims |
| 3e | Question-framed notes | When evidence is inconclusive |
| 3f | Higher-level API notes | Abstract over multiple concepts |
| 3g | Synthesis notes | Draw from many sources |
| 4 | Outline notes | Structured summaries of related ideas |

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Titles as APIs** | Agent can reason about the vault at the title level without reading every note body. The most valuable single principle for agent navigation |
| **Atomicity** | Clean RAG chunks. Agent should flag multi-concept notes for splitting |
| **Concept-orientation** | Agent detects duplicate concepts across sources and suggests merging/linking |
| **Dense linking as graph** | Agent follows 1–2 hops of backlinks for context; suggests links between unlinked notes |
| **Maturity metadata** | Seedling notes carry less weight than evergreen notes in synthesis |
| **Accretion principle** | Each agent interaction should leave the vault slightly better — updating stale notes, adding links, promoting seedlings |
| **Writing inbox** | Maps to agent's task queue for unprocessed captures |

---

## PARA

**Origin:** Tiago Forte, *Building a Second Brain* (2022).

### Structure

Four categories ordered by actionability (most → least):

| Category | Definition | Has an end date? |
|---|---|---|
| **Projects** | Short-term efforts with a specific goal and deadline | Yes |
| **Areas** | Ongoing domains requiring continuous attention (Health, Finances, Writing) | No |
| **Resources** | Topics of interest you collect info about, but have no responsibility for | No |
| **Archives** | Inactive items from the other three categories | N/A |

Plus an unofficial **Inbox** as a capture buffer.

### Key Principles

- **Organize by actionability, not topic** — like a kitchen organized by current service, not ingredient type
- **Just-in-time organization** — organize as a byproduct of work, not in batch sessions
- **Shallow hierarchies** — favor horizontal movement between the four categories over deep nesting
- **Dynamic movement** — items move between categories as status changes (Resource → Project → Archive)
- **Start minimal** — begin with just Projects and Archive; add Areas and Resources only when needed

### The PARA/Zettelkasten Tension

| Dimension | PARA | Zettelkasten |
|---|---|---|
| Metaphor | Filing cabinet | Neural network |
| Organizing principle | Actionability (containers) | Connections (links) |
| Optimized for | Execution and project delivery | Knowledge creation and synthesis |
| Note stability | Dynamic — notes move between categories | Permanent — notes accumulate |

They can be combined: PARA manages the action layer, Zettelkasten manages the thinking layer.

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Actionability as relevance signal** | Projects folder = most likely currently relevant. Archives = historical background. Agent uses folder as priority heuristic |
| **Predictable top-level structure** | Agent knows exactly four categories and their semantics without learning an idiosyncratic hierarchy |
| **Project folders as scoping boundaries** | Agent working on "Website Redesign" scopes to that project folder for coherent context |
| **Archive as long-term memory** | Fallback search when primary categories don't yield results |
| **Frontmatter encoding** | `para: project`, `status: active` enables filtered queries |
| **Just-in-time organization as agent behavior** | Agent organizes (tags, links, moves) as a side effect of completing tasks |

**Key limitation:** Folder siloing is *worse* for agents than humans. A human remembers a relevant note exists elsewhere; an agent must be told to search across categories or rely on cross-category links.

---

## GTD (Getting Things Done)

**Origin:** David Allen (2001). The dominant task management methodology.

### Core Data Structures

| Structure | Purpose |
|---|---|
| **Inbox** | Universal capture point. Everything enters here unsorted |
| **Next Actions** | The single next physical action for each project, tagged with a context (`@computer`, `@phone`, `@errands`) |
| **Projects** | Any outcome requiring more than one action step. Must always have at least one next action |
| **Waiting For** | Actions delegated to others, tracked with a date |
| **Someday/Maybe** | Uncommitted ideas and aspirations |
| **Reference** | Non-actionable information for future use |

### The Weekly Review

The critical maintenance ritual:
1. Process inbox to zero
2. Review all projects for next actions
3. Update waiting-for items
4. Clean up someday/maybe

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Inbox as write target** | Agent always knows where to put new items without classifying first |
| **Context tags** | Machine-parseable markers (`@computer`, `@home`) let agent filter by capability |
| **Next action enforcement** | "Every project must have a next action" — programmatically auditable rule |
| **Weekly review as prompt** | The review checklist is a natural structured prompt for an agent |
| **Clear state machine** | Items have well-defined states (inbox → project/next-action/waiting/someday/reference/trash) |
| **Dataview queries as API** | Existing Dataview queries for GTD function like a query API |

---

## Progressive Summarization

**Origin:** Tiago Forte. A technique for making notes progressively more discoverable over time.

### The Five Layers

| Layer | Action | What it produces |
|---|---|---|
| **0** | Original source | The raw material |
| **1** | Initial capture | Passages and thoughts saved — no filtering |
| **2** | Bold | **Bold the best parts** — keywords, key phrases, core ideas |
| **3** | Highlight | ==Highlight the best of the bolded== — the truly unique or valuable |
| **4** | Executive summary | Write a summary at the top in your own words |
| **5** | Remix | Create entirely new work from the material |

**Key principle:** Opportunistic compression — each layer is applied only when you *happen to revisit* the note for other work, not as a dedicated processing session. All layers are preserved; no information is destroyed.

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Layer metadata as priority signal** | Agent prioritizes Layer 4 notes (most distilled) over Layer 1 (raw) |
| **Executive summary for RAG** | Layer 4 summary = exactly what retrieval-augmented generation needs |
| **AI can perform the layers** | Agent automates Layer 2 (key passages), Layer 3 (most unique), Layer 4 (summary) |
| **Preserved context** | Poor agent summarization doesn't destroy data — original text remains |
| **Context window management** | Use summaries when many notes are relevant; full text when few are |

**Simplification for agents:** Layers 2 and 3 (bold vs. highlight) are meaningful for human visual scanning but identical to an AI reading markdown. Collapse into a single "key passages" marker. Layer 4 (executive summary) is the critical one.

---

## Digital Gardens

**Origin:** A movement rather than a single author. Key voices: Maggie Appleton, Gwern Branwen, Joel Hooks.

### Core Philosophy

- Non-linear: linked by topic, not time
- Perpetually unfinished: notes are works-in-progress at varying maturity
- Transparent epistemics: signal confidence and completeness openly

### Maturity Stages

**Simple model (most common):**

| Stage | Description |
|---|---|
| **Seedling** | Rough early explorations, may be inaccurate |
| **Budding** | Developing thoughts, somewhat developed |
| **Evergreen** | Mature, refined, stable |

**Extended model (ontheagilepath.net):**

| Stage | Tag | Description |
|---|---|---|
| Nut | `#epstatus/0` | Initial capture. Unvetted |
| Seedling | `#epstatus/1` | Active work begun. May contain errors |
| Potted Plant | `#epstatus/2` | Mature enough to build upon |
| Tree | `#epstatus/3` | Thoroughly developed. High confidence |
| Ancient Tree | `#epstatus/4` | Knowledge becoming outdated |
| Fallen Leaf | `#epstatus/5` | Obsolete but preserved |

### Epistemic Status (from Gwern)

| Confidence | Meaning |
|---|---|
| certain | No significant doubt |
| highly likely | Very strong evidence |
| likely | Preponderance of evidence |
| possible | Some evidence, uncertain |
| unlikely | Evidence against |
| remote | Almost no support |

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Maturity as trust signal** | Agent weighs Tree notes more heavily than Nut notes. Built-in reliability indicator |
| **Epistemic status** | `confidence: possible` tells agent to treat content as speculative |
| **Obsolescence tracking** | Ancient Tree / Fallen Leaf stages flag stale knowledge automatically |
| **Growth lifecycle** | Agent promotes notes through stages — processing Nuts into Seedlings, flagging Trees for review |
| **Non-linear linking** | Graph-native navigation matches how agents should traverse knowledge |

---

## Cornell Note-Taking

**Origin:** Walter Pauk, Cornell University (1950s).

### The Three-Section Format

| Section | Width | Purpose |
|---|---|---|
| **Cue Column** (left) | ~30% | Keywords, questions, retrieval prompts — written *after* the content |
| **Notes Column** (right) | ~70% | Main content captured during lecture/reading |
| **Summary** (bottom) | full width | 2–4 sentence synthesis of the page |

### Obsidian Adaptation

Uses callouts:
```markdown
>[!cue] Key question?
Main notes content here

>[!summary] Summary
> 2-4 sentence synthesis of the key ideas
```

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Cue column as query interface** | Cues are natural-language questions — agent uses them as retrieval index or generates them automatically |
| **Summary as TL;DR** | Agent assesses note relevance without reading full content |
| **Structured extraction targets** | Three sections map to what an agent can generate: extract cues, organize content, produce summary |
| **Template-driven validation** | Rigid structure is easy to validate programmatically |

**For agents, the *concept* of three sections matters more than the visual layout.** The CSS positioning is irrelevant — the parseable schema is what counts.

---

## Johnny.Decimal

**Origin:** Johnny Noble. A rigid numbering system.

### Structure

- **Areas** (10–19, 20–29, ... 90–99): Up to 10 broad domains
- **Categories** (11, 12, 13 within an area): Up to 10 per area
- **IDs** (11.01, 11.02, ... 11.99): Individual items

The **AC.ID** notation (e.g., `23.07`): area 20–29, category 23, item 07.

### Agent Relevance

| Concept | Why it matters for AI |
|---|---|
| **Deterministic paths** | Agent computes exactly where a file lives without searching |
| **Machine-readable taxonomy** | Numeric hierarchy is trivially parseable (`\d{2}\.\d{2}`) |
| **Finite structure** | 10-item constraint means bounded choices at every level |
| **Stable references** | IDs never change, so links are durable |

**Key limitation:** Too rigid for organic knowledge growth. The 10-item constraint and upfront allocation conflict with emergent structure. Best applied to a specific subset (e.g., project files) rather than vault-wide.

---

## Synthesis: What to Adopt for an AI-Native Vault

### Tier 1: Adopt Fully

These concepts translate directly into agent affordances and should be built into the vault template:

| Concept | Source | Implementation |
|---|---|---|
| **Atomic notes** | Zettelkasten, Evergreen | One concept per note. Agent flags multi-concept notes for splitting |
| **Titles as APIs** | Evergreen Notes | Declarative, complete-phrase titles. Agent reasons at title level |
| **Maturity metadata** | Digital Gardens | Frontmatter `status: seedling/budding/evergreen`. Agent weighs notes accordingly |
| **Executive summary at top** | Progressive Summarization (L4), Cornell | Every substantive note gets a `>[!summary]` callout. Agent uses for fast relevance |
| **MOCs as navigational hubs** | LYT | Agent reads MOCs to orient; suggests new MOCs when clusters reach ~20 notes |
| **Home Note** | LYT | Single root entry point for agent graph traversal |
| **`up:` link in frontmatter** | LYT | Every note links to its parent MOC. Agent navigates upward for context |
| **Inbox folder** | GTD, PARA | Universal write target. Agent captures here without classifying |
| **Dense, contextual linking** | Zettelkasten, Evergreen | Links include *why* the connection exists. Agent traverses for multi-hop context |
| **Source/thinking separation** | Zettelkasten | Reference notes (what others said) vs. permanent notes (what you think) |

### Tier 2: Adopt Selectively

Useful for specific vault regions but not as universal principles:

| Concept | Source | When to use |
|---|---|---|
| **PARA's actionability axis** | PARA | For the Efforts/Projects portion of the vault. Not for knowledge notes |
| **Context tags** | GTD | On actionable items: `@computer`, `@phone`, `@errands`. Not on knowledge notes |
| **Next action enforcement** | GTD | Agent audits that every project has a next action |
| **Epistemic status** | Digital Gardens/Gwern | On research and speculative notes: `confidence: likely` |
| **Progressive layers** | Progressive Summarization | Track `summary-layer: 4` in frontmatter for processing priority |
| **Fractal journaling** | Steph Ango | Daily → weekly → monthly temporal rollups. Agent aggregates automatically |
| **Cue/question sections** | Cornell | On learning-oriented notes. Agent generates cues as retrieval aids |

### Tier 3: Skip or Simplify

| Concept | Source | Why skip |
|---|---|---|
| **Deep folder hierarchies** | PARA, Johnny.Decimal | Siloing is worse for agents than humans. Use links + metadata instead of folders |
| **Bold vs. highlight distinction** | Progressive Summarization L2/L3 | Meaningful for human scanning, identical to AI reading markdown |
| **Rigid numbering** | Johnny.Decimal | Too rigid for emergent knowledge. Only useful for a fixed project taxonomy |
| **Visual layouts** | Cornell CSS | Irrelevant to agents reading markdown. Keep the *schema*, drop the *styling* |
| **Fleeting notes as a formal category** | Zettelkasten | Just use the Inbox. Don't create a separate "fleeting" folder |
| **Branching IDs (Folgezettel)** | Luhmann's Zettelkasten | Title-based wikilinks are superior in digital systems |

### Proposed Folder Structure

Combining the best elements:

```
Home.md                    # LYT: root entry point, links to all top-level MOCs
+/                         # GTD: Inbox — universal capture point
Atlas/                     # LYT: knowledge (concept notes, source notes, MOCs)
Calendar/                  # LYT: temporal (daily notes, journals, reviews)
Efforts/                   # LYT/PARA: active projects and areas
  Projects/                # PARA: time-bound with goals and deadlines
  Areas/                   # PARA: ongoing responsibilities
Archive/                   # PARA: completed/inactive items
x/                         # LYT: infrastructure (templates, scripts, attachments)
  Templates/
  Attachments/
```

### Proposed Frontmatter Standard

```yaml
---
up: "[[Parent MOC]]"           # LYT: upward navigation
status: seedling               # Digital Gardens: seedling | budding | evergreen
confidence: likely             # Gwern: certain | likely | possible | speculative
type: concept                  # concept | source | moc | project | daily | task
created: 2026-03-03
last-tended: 2026-03-03
tags: []
summary-layer: 4               # Progressive Summarization: 1-5
---

>[!summary]
> Executive summary here (Progressive Summarization Layer 4)

# Note Title as API (Evergreen Notes)

Content: one atomic concept in your own words (Zettelkasten)

## Related
- [[Note A]] — why this connects (Zettelkasten: explicit link context)
- [[Note B]] — how this contrasts
```

### The Agent's Role Across Methodologies

The AI assistant can absorb the maintenance overhead that makes these systems unsustainable for most people:

| Human struggle | Agent solution | Methodology source |
|---|---|---|
| Writing atomic notes from raw captures | Agent converts fleeting notes to formatted Zettels | Zettelkasten |
| Maintaining dense links | Agent suggests links between unlinked notes | Evergreen, Zettelkasten |
| Creating and updating MOCs | Agent detects clusters, proposes MOCs, keeps them current | LYT |
| Progressive summarization | Agent applies Layers 2–4 automatically | Progressive Summarization |
| Weekly review | Agent audits projects for next actions, processes inbox | GTD |
| Maturity promotion | Agent promotes seedlings when evidence strengthens, flags stale trees | Digital Gardens |
| Orphan detection | Agent finds unlinked notes and suggests integration | Evergreen, LYT |
| Consistency enforcement | Agent validates frontmatter, naming conventions, link formats | All |
| Deduplication | Agent detects overlapping concepts across sources | Evergreen |

This is the fundamental unlock: **methodologies that were too maintenance-heavy for humans become practical when an agent handles the upkeep.**

---

## Sources

### Zettelkasten
- [Introduction to the Zettelkasten Method](https://zettelkasten.de/introduction/) — zettelkasten.de
- [How to Take Smart Notes](https://takesmartnotes.com/) — Sönke Ahrens
- [Getting Started with Zettelkasten in Obsidian](https://obsidian.rocks/getting-started-with-zettelkasten-in-obsidian/)
- [When AI Becomes Your Zettelkasten's Co-Pilot](https://www.mycelium-of-knowledge.org/when-ai-becomes-your-zettelkastens-co-pilot-how-an-agent-changed-my-knowledge-workflow/)
- [A-Mem: Agentic Memory for LLM Agents](https://arxiv.org/html/2502.12110v2) — arXiv

### LYT
- [Linking Your Thinking](https://www.linkingyourthinking.com/) — Nick Milo
- [The Ultimate Folder System: A Quixotic Journey to ACE](https://forum.obsidian.md/t/the-ultimate-folder-system-a-quixotic-journey-to-ace/63483) — Obsidian Forum
- [Zettelkasten, LYT, and Nick Milo's Search for Ground](https://writing.bobdoto.computer/zettelkasten-linking-your-thinking-and-nick-milos-search-for-ground/) — Bob Doto

### Evergreen Notes
- [Evergreen notes](https://notes.andymatuschak.org/Evergreen_notes) — Andy Matuschak
- [Evergreen note titles are like APIs](https://notes.andymatuschak.org/Evergreen_note_titles_are_like_APIs) — Andy Matuschak
- [Evergreen notes turn ideas into objects](https://stephango.com/evergreen-notes) — Steph Ango
- [Knowledge work should accrete](https://notes.andymatuschak.org/Knowledge_work_should_accrete) — Andy Matuschak

### PARA
- [The PARA Method](https://fortelabs.com/blog/para/) — Tiago Forte / Forte Labs
- [PARA vs Zettelkasten](https://zettelkasten.de/posts/building-a-second-brain-and-zettelkasten/) — zettelkasten.de
- [How to Implement PARA in Obsidian](https://mattgiaro.com/para-obsidian/) — Matt Giaro

### GTD
- [GTD with Obsidian](https://forum.obsidian.md/t/gtd-with-obsidian-a-ready-to-go-gtd-system-with-task-sequencing-quick-add-template-waiting-on-someday-maybe-and-more/65502) — Obsidian Forum
- [GTD for Claude Code](https://github.com/nikhilmaddirala/gtd-cc) — GitHub

### Progressive Summarization
- [Progressive Summarization](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/) — Tiago Forte

### Digital Gardens
- [Growing the Evergreens](https://maggieappleton.com/evergreens) — Maggie Appleton
- [Maturity model for Obsidian notes](https://digital-garden.ontheagilepath.net/maturity-model-for-my-obsidian-notes)
- [Gwern.net confidence tags](https://gwern.net/about) — Gwern Branwen

### Cornell Note-Taking
- [Cornell Notes in Obsidian](https://dev.to/sanathks/highly-effective-cornell-notes-with-obsidian-6le) — DEV Community
- [Cornell Notes Learning Vault](https://tfthacker.com/cornell-notes) — TfTHacker

### Johnny.Decimal
- [Johnny.Decimal](https://johnnydecimal.com/) — Official site
- [JD + Obsidian](https://forum.obsidian.md/t/q-for-those-using-johnny-decimal-system/87070) — Obsidian Forum
