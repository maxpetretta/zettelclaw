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
- [Practitioner Spotlight: James Bedford's "Everyday Obsidian"](#practitioner-spotlight-james-bedfords-everyday-obsidian)
- [Design Principle: Human Writes, Agent Reads](#design-principle-human-writes-agent-reads)
- [Obsidian Primitives for Human-Write, Agent-Read Vaults](#obsidian-primitives-for-human-write-agent-read-vaults)
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

## Practitioner Spotlight: James Bedford's "Everyday Obsidian"

James Bedford ([@jameesy](https://x.com/jameesy)) is an engineer at Zerion and creator of the [Everyday Obsidian](https://www.everydayobsidian.com/) course. His approach is notable for being specifically designed around Claude integration from the ground up, with a vault structure that balances simplicity with agent-navigability.

### Vault Structure

Five folders, each with a distinct purpose:

| Folder | Purpose | Agent relevance |
|---|---|---|
| **Polaris** | North Star — goals, aspirations, values, "Top of Mind" document | Claude references this constantly as a guiding context. Updated every ~2 weeks. The biggest win for agent efficiency |
| **Logs** | Daily notes, used as a scratchpad for on-the-fly writing | Temporal context — agent reads recent logs to understand current state |
| **Commonplace** | The main vault — separate notes for individual thoughts, true to the commonplace book tradition | The knowledge base proper. Each note has tags as metadata |
| **Outputs** | Written articles, social media posts, finished work | Agent writes here; clear separation of drafts from source thinking |
| **Utilities** | Templates, prompts, commands specific to the user's workflow | Agent reads to understand available operations and conventions |

### Key Concepts

**The "Polaris" Document.** Bedford's most distinctive contribution. A dedicated note (or folder) containing:
- What is currently top of mind
- Active goals and aspirations
- Personal values and priorities
- Things to stay accountable to

Claude references this as a guiding context for all interactions. Bedford reports it "holds him accountable for losing focus on things and chasing shiny objects" — the agent uses it to filter suggestions and prioritize recommendations.

**Separation of Human and AI Content.** Bedford maintains a dedicated "Claude" folder *outside* the Obsidian vault for AI-generated content and working files (GitHub repos, meeting notes processed by Claude). This keeps the knowledge graph clean — AI-generated content doesn't pollute backlink and tag indexes unless explicitly promoted to the vault.

**Tags as Metadata.** Bedford considers tags "one of the most criminally underutilised ways of navigating through an Obsidian vault." His approach:
- Nested tags with parent/child relationships
- Every commonplace note has tags as metadata at the top
- Tags enable efficient filtering when Claude scans for relevant content
- More structured than free-form text, more flexible than folders

**The "Idea Report."** A Claude-generated output that cross-references the user's notes to produce:
- Things to build
- People to reach out to
- Ideas to investigate
- Connections between thoughts and written materials

This is Bedford's showcase for agent-augmented knowledge work — the agent synthesizes across the vault and presents actionable suggestions aligned with the Polaris priorities.

**Three Navigation Methods.** Bedford uses folders, tags, and backlinks together — each serves a different navigation mode:
1. Folders for broad context (where am I working?)
2. Tags for metadata filtering (what type of thing is this?)
3. Backlinks for graph traversal (what connects to this?)

### What to Incorporate

Bedford's key innovations for an AI-native vault:

| Concept | Why adopt it |
|---|---|
| **Polaris / "Top of Mind" document** | Gives the agent a persistent values/goals reference. Without this, the agent optimizes for the current task without awareness of broader priorities |
| **Separation of AI and human content** | Prevents agent output from polluting the knowledge graph. Clean signal for backlinks and tags |
| **Idea Reports as a skill** | Demonstrates the agent's highest-value mode: cross-vault synthesis producing actionable suggestions |
| **Tags as first-class metadata** | More queryable than prose, more flexible than folders. Agent reads tag structure to understand the vault's ontology |

---

## Design Principle: Human Writes, Agent Reads

The strongest pattern across the research is a division of labor: **the human is responsible for writing content in the vault; the agent primarily reads and searches to surface insights, connections, and suggestions.** The vault is the human's externalized thinking. The agent is a very fast, very thorough, never-forgets reader that can traverse the entire graph and notice things the human can't hold in working memory.

This principle is not just a preference — it's grounded in the deepest claims of the methodologies themselves.

### Methodological Foundations

**Zettelkasten: The "Communication Partner."** Luhmann wrote every card himself but described his slip-box as a *"true interlocutor"* that surprised him through rediscovered forgotten ideas and unexpected connection patterns. The system didn't write — it *responded*. The human-writes/system-reads dynamic is the original design. An AI agent that reads the vault and surfaces surprises is doing exactly what Luhmann's slip-box did, just faster and across a larger graph.

**Evergreen Notes: Writing *is* thinking.** Matuschak's foundational claim: "Better note-taking misses the point; what matters is better thinking." Notes must be in your own words and your own voice because the act of writing is the act of understanding. An agent that writes notes for you defeats the purpose — you haven't thought through the idea. But an agent that *reads* your notes and surfaces connections, flags contradictions, or suggests links is doing exactly what the dense-linking principle calls for.

**LYT: The Relate gap.** Nick Milo's ARC framework identifies that most people spend 50%+ of their time Adding (capturing) and skip the Relate phase (contextualizing, connecting, challenging). An agent that reads the vault and suggests connections is the missing Relate engine. It doesn't create ideas — it relates the human's ideas to each other.

**Digital Gardens: The author tends.** The epistemic status metadata (`confidence: likely`) is a *human judgment* about the author's own thinking. The maturity stages (seedling → evergreen) track the author's development of an idea. An agent can flag seedlings for promotion or identify stale trees, but the assessment of confidence and the writing of the note remain human acts.

**Steph Ango: Emergent structure from human linking.** Ango deliberately avoids automating his "random revisit" sessions — browsing old notes to create connections — because maintaining personal understanding is the point. An agent that *suggests* rather than *imposes* structure fits his philosophy: "embrace chaos and laziness to create emergent structure."

### Practitioner Evidence

| Practitioner | How they express this principle |
|---|---|
| **James Bedford** | Separates AI-generated content from the vault entirely. Claude reads the Polaris doc and commonplace notes, produces Idea Reports with suggestions. The human decides what to act on |
| **Kent de Bruin** | AI "fills gaps, surfaces connections, and deepens thinking **without replacing the author's voice**" |
| **Eleanor Konik** | "Knowledge **utilization** over management." She writes and reads; Claude handles organizational maintenance. The note content stays hers |
| **YouTube / Vin** | Custom commands are all *read* operations: "challenge" finds contradictions, "trace" tracks idea evolution, "emerge" surfaces conclusions. The vault is the "source of truth" maintained by the human |
| **Teresa Torres** | Uses Claude as a "sparring partner" — she writes the actual prose herself. Claude reviews for clarity but doesn't generate the core content |

### What the Agent *Does* Do

The agent isn't passive. Within the "read and surface" model, the agent's active contributions are:

**Navigation and retrieval:**
- Search across the full vault (QMD, CLI, backlinks) to find relevant notes the human forgot about
- Traverse the link graph to surface multi-hop connections
- Read MOCs and the Home Note to orient itself in the vault's structure

**Synthesis and surfacing:**
- Generate Idea Reports that cross-reference notes and suggest actions (Bedford)
- Identify contradictions between notes written months apart (challenge mode)
- Track how a concept evolved over time across the vault (trace mode)
- Surface conclusions latent in scattered premises the human hasn't connected (emerge mode)
- Find orphan notes and suggest where they connect

**Maintenance (with human review):**
- Suggest links between unlinked notes — human approves
- Flag notes that may need splitting (violate atomicity)
- Identify seedlings that have grown enough to be promoted
- Flag evergreen notes whose references are outdated
- Validate frontmatter consistency and naming conventions
- Submit changes via git PRs for human review (Konik's pattern)

**What the agent does *not* do in this model:**
- Write permanent/evergreen notes from scratch
- Decide what the human thinks about a topic
- Assign epistemic status or confidence levels
- Create MOCs without the human's involvement
- Move notes between maturity stages without signaling
- Generate content that enters the knowledge graph without explicit promotion

### The Boundary

The dividing line: **the agent handles the cognitive overhead of the system so the human can focus on thinking.** The human's job is to write, read, reflect, and decide. The agent's job is to remember, search, connect, and surface. The vault is the shared medium — the human writes into it, the agent reads from it, and insights flow back to the human as suggestions rather than edits.

This is the difference between an agent as a *ghostwriter* (writes for you) and an agent as a *research librarian* (knows every book in the collection and can find the three you need right now).

---

## Obsidian Primitives for Human-Write, Agent-Read Vaults

How do the methodologies and practitioners actually use Obsidian's native building blocks? And which uses create the most signal for an agent that reads rather than writes?

### Frontmatter Properties: The Agent's Primary Index

Frontmatter is the single most important primitive for agent reading. The agent can parse the first 10 lines of YAML and know a note's type, status, confidence, parent MOC, and creation date — without reading the markdown body at all.

**How practitioners use it:**

| Field | Who uses it | What the agent gets |
|---|---|---|
| `type: concept` | Zettelkasten, LYT, Ango | Instant note classification — agent knows what structure to expect |
| `status: seedling` | Digital Gardens, Bedford | Maturity signal — agent weighs evergreen notes over seedlings |
| `confidence: likely` | Gwern, Digital Gardens | Trust calibration — agent avoids presenting speculative content as fact |
| `up: "[[Parent MOC]]"` | LYT | Upward navigation — agent always knows the broader context |
| `tags: [domain/ai, type/concept]` | Bedford, all | Filtering without reading body text |
| `created` / `last-tended` | Ango, Matuschak | Temporal queries and staleness detection |
| `related: ["[[Note A]]"]` | Zettelkasten | Explicit graph edges parseable from YAML, supplementing inline wikilinks |
| `aliases: ["alt name"]` | Obsidian native | Agent finds notes by alternative names |
| `summary-layer: 4` | Progressive Summarization | Processing priority — agent knows which notes are most distilled |

**The design rule:** Use enum-constrained values (not free text) for fields the agent will filter on. `status: seedling` is deterministic; `status: "still working on this one"` is not.

**Bases vs. Dataview:** Bases (`.base` files) are YAML-defined database views over frontmatter. They're trivially writable by agents (the obsidian-skills SKILL.md provides the full spec) and queryable via CLI (`obsidian base:query format=json`). Dataview uses a bespoke query language agents frequently get wrong. For an agent-read vault, **Bases are the better primitive** — and they support bidirectional editing (changing a cell updates the note's frontmatter).

### Wikilinks: The Knowledge Graph

Wikilinks (`[[Note Title]]`) are how the vault becomes a graph rather than a folder of files. For the human-writes/agent-reads model, they're the primary navigation layer the agent traverses.

**How practitioners use them:**

| Pattern | Who | Agent benefit |
|---|---|---|
| **Dense inline linking** | Zettelkasten, Matuschak, Ango | Agent follows 1–2 hops of links for context around any note |
| **Unresolved links as breadcrumbs** | Ango | Placeholders for notes that don't exist yet — agent can surface these as "ideas to develop" |
| **Annotated links in Related sections** | Zettelkasten | `[[Note A]] — why this connects` gives the agent the *reason* for the connection, not just the edge |
| **MOCs as curated link lists** | LYT, de Bruin | Agent reads a MOC to understand an entire topic domain in one note |
| **`up:` links in frontmatter** | LYT | Structured upward navigation — agent climbs from any note to its MOC to the Home Note |
| **Embeds (`![[Note#section]]`)** | Obsidian native | Agent can read embedded content in-place without following the link |

**The community consensus:** Tags for attributes, links for relationships. An agent uses tags to narrow the search space (what *kind* of notes?), then links to traverse within it (how do they *connect*?).

### Tags: Classification Layer

Tags serve as the machine-readable classification system the agent scans without reading note bodies.

**The standout patterns:**

**Multi-dimensional tag namespaces.** The most agent-friendly vaults use 3–5 orthogonal tag dimensions:

```
#type/concept          — what kind of note
#status/budding        — how mature
#domain/ai/agents      — what topic area
#project/zettelclaw    — which project
#source/article        — where the idea came from
```

Each dimension is independently queryable. The agent can intersect them: "find all budding concept notes in ai/agents for zettelclaw."

**Tag-as-action markers.** Some practitioners use tags as workflow triggers an agent can scan for:

```
#process    — needs processing from inbox
#split      — violates atomicity, needs breaking apart
#stale      — content may be outdated
#connect    — orphan that needs links
#promote    — seedling ready for promotion
```

An agent scanning for `#process` gets an instant work queue without natural language parsing.

**Inline tags for paragraph-level annotation.** Tags mid-paragraph let the agent extract tagged lines without reading full notes:

```markdown
- This contradicts what I wrote in [[Other Note]] #contradiction
- Need to verify with primary sources #verify
```

**Bedford's approach:** Tags on every commonplace note, nested with parent/child relationships. Tags enable Claude to filter efficiently when scanning for relevant content. "One of the most criminally underutilised ways of navigating through an Obsidian vault."

**The CLI unlock:** `obsidian tags sort=count counts` gives the agent the full tag taxonomy in one command — no file scanning needed.

### Callouts: Semantic Sections Within Notes

Callouts (`>[!type]`) create typed, delimited blocks within unstructured prose. For an agent reading notes, they're the most reliable way to extract specific *kinds* of content.

**The callouts that matter most for agent reading:**

| Callout | Agent use | Example |
|---|---|---|
| `>[!summary]` / `>[!abstract]` | Fast relevance assessment without reading full note | Every substantive note should have one |
| `>[!question]` | Open threads the agent can help with or surface in reports | "What's the relationship between X and Y?" |
| `>[!quote]` | Attributed source material — distinguishable from the author's own thinking | Supports source/thinking separation |
| `>[!example]` | Concrete instances that ground abstract concepts | Agent uses to explain concepts back to the user |
| `>[!warning]` | Caveats that constrain how information should be applied | Agent includes these when surfacing the note |
| `>[!todo]` | Actionable items the agent can track | Complement to GTD-style task management |

**Custom callouts for agent context:**

```markdown
> [!agent-context]
> This section provides context specifically for AI agent consumption.
> Not visible in most reading workflows but parseable by the agent.
```

**Hidden comments for agent instructions:** Obsidian's `%%...%%` syntax creates comments invisible in reading view but visible in raw markdown:

```markdown
%%agent: This note needs updating — the API changed in v3%%
```

An agent reading raw markdown sees these; a human in reading view doesn't.

### Templates: Enforcing Parseable Structure

Templates make notes consistently structured so the agent can predict what it will find.

**The minimum viable template for an agent-read vault:**

```markdown
---
type: concept
status: seedling
up: "[[Parent MOC]]"
tags: []
created: {{date}}
---

>[!summary]
> One-sentence summary.

# {{title}}

Content in your own words.

## Related
- [[Note]] — why it connects
```

This gives the agent: type (frontmatter), maturity (status), navigation (up), fast relevance (summary callout), and graph edges (Related section) — all in a predictable structure.

**Templater** extends this with dynamic generation: auto-populated dates, navigation links to previous/next daily notes, UIDs, and Dataview queries. The key capability is **folder templates** — auto-applying the right template when a note is created in a specific folder, so the human never has to think about structure.

### Bases: Computed Views for Agent Querying

Obsidian Bases (`.base` files) are YAML-defined database views over vault frontmatter. They stand out for the agent-read model because:

1. **The agent can write `.base` files** to create custom views — the obsidian-skills SKILL.md provides the full specification
2. **The CLI enables reading results** — `obsidian base:query format=json` returns structured data
3. **Computed properties** — formulas like `days_until_due` or `is_overdue` produce derived data without the human calculating anything
4. **Bidirectional editing** — changing a cell in a Base view updates the note's frontmatter

**Practical use:** The agent creates a `.base` file that filters for `#status/stale` notes older than 6 months, queries it via CLI, and presents the results as a "vault health report." The human wrote all the notes; the agent computed the view.

### Canvas: Spatial Thinking (Human Primitive)

JSON Canvas (`.canvas` files) are spatial layouts of notes, images, and cards. These are primarily a *human* primitive — visual arrangement for thinking — but an agent can:

- Read a canvas to understand how the human has spatially grouped ideas
- Generate canvas files as visual summaries (ClawVault does this)
- The obsidian-skills `json-canvas` SKILL.md teaches agents the node/edge/group format

For the human-writes/agent-reads model, canvas is lower priority — the graph structure in links and MOCs is more traversable than spatial layout.

### Primitive Ranking for Human-Write, Agent-Read

Ordered by value to an agent that reads and surfaces:

| Rank | Primitive | Agent value | Human effort to maintain |
|---|---|---|---|
| 1 | **Frontmatter properties** | Instant classification, filtering, structured queries | Low — templates auto-populate most fields |
| 2 | **Wikilinks** | Graph traversal, multi-hop context, relationship discovery | Medium — requires linking discipline |
| 3 | **`>[!summary]` callouts** | Fast relevance assessment across hundreds of notes | Low — one sentence per note |
| 4 | **Tags (nested)** | Taxonomy scanning, dimension-based filtering | Low — applied at note creation |
| 5 | **MOCs (via wikilinks)** | Topic orientation without full-vault search | Medium — emerges when clusters form |
| 6 | **Bases** | Computed views, structured CLI queries, health reports | Low — agent can create these |
| 7 | **Templates** | Structural consistency the agent can predict | One-time setup |
| 8 | **`%%hidden comments%%`** | Agent-only instructions invisible to reading view | Low — occasional |
| 9 | **Canvas** | Spatial context (secondary to graph context) | Variable — optional |

The top 4 (frontmatter, wikilinks, summary callouts, tags) form a complete read interface for an agent. If a vault has these four primitives used consistently, the agent can navigate, filter, assess relevance, and traverse the knowledge graph without reading every note body.

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
| **Polaris / "Top of Mind" doc** | Bedford | Persistent goals/values reference the agent consults for all suggestions |
| **AI/human content separation** | Bedford | Agent output in a separate space; only promoted content enters the knowledge graph |

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

### The Agent's Role: Read, Search, Surface

Following the [design principle](#design-principle-human-writes-agent-reads), the agent operates as a reader and navigator — not a writer. It absorbs the *cognitive overhead* of maintaining the system so the human can focus on thinking and writing.

| Human struggle | What the agent does | What it does *not* do | Source |
|---|---|---|---|
| Can't remember what you wrote | Searches vault, surfaces relevant notes | Write new notes for you | Zettelkasten |
| Missing connections between notes | Suggests links between unlinked notes | Create links without approval | Evergreen, Zettelkasten |
| Too many notes to hold in mind | Detects clusters, proposes MOC structure | Build MOCs unilaterally | LYT |
| Notes pile up unprocessed | Flags inbox items needing attention, suggests where they connect | Decide what the human thinks about them | GTD |
| Can't track idea evolution | Traces how a concept changed across months of notes | Assign meaning to the evolution | Zettelkasten |
| Stale notes go unnoticed | Flags evergreen notes with outdated references, identifies seedlings ready for promotion | Promote or demote without signaling | Digital Gardens |
| Orphan notes accumulate | Finds unlinked notes, suggests integration points | Delete or reorganize autonomously | Evergreen, LYT |
| Inconsistent formatting | Validates frontmatter, naming conventions, link formats; reports violations | Silently rewrite content | All |
| Overlapping concepts across sources | Detects duplicates, flags for human merge decision | Merge notes without approval | Evergreen |
| Losing focus on priorities | Reads Polaris doc, filters suggestions through goals/values | Decide what matters | Bedford |
| Hard to see the big picture | Generates Idea Reports: cross-vault synthesis with actionable suggestions | Act on the suggestions | Bedford |
| No time for vault maintenance | Submits cleanup changes via git PRs for human review | Commit directly without review | Konik |

The fundamental unlock: **methodologies that were too maintenance-heavy for humans become practical when an agent handles the overhead — while the human retains authority over what the vault says.**

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
