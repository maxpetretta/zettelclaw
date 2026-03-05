# Zettelclaw Obsidian Plugin & `/ask` Command: Technical Specification

> Spec drafted March 2026. Defines the Obsidian plugin for Zettelclaw — a shared human + agent vault system — and the inline `/ask` command for querying an AI agent from within notes.

## Table of Contents

- [Context: What Zettelclaw Is](#context-what-zettelclaw-is)
- [Where the Plugin Fits](#where-the-plugin-fits)
- [Design Principles](#design-principles)
- [Plugin Overview](#plugin-overview)
  - [Plugin Responsibilities](#plugin-responsibilities)
  - [What the Plugin Does Not Do](#what-the-plugin-does-not-do)
- [The `/ask` Command](#the-ask-command)
  - [Callout Protocol](#callout-protocol)
  - [The Ask Callout](#the-ask-callout)
  - [The Agent Callout](#the-agent-callout)
  - [Lifecycle States](#lifecycle-states)
  - [Examples](#examples)
- [System Architecture](#system-architecture)
  - [Full Stack Diagram](#full-stack-diagram)
  - [Layer Responsibilities](#layer-responsibilities)
- [Data Flow](#data-flow)
  - [Plugin-Triggered Flow](#plugin-triggered-flow)
  - [Watcher-Triggered Flow](#watcher-triggered-flow)
  - [Manual CLI Flow](#manual-cli-flow)
  - [OpenClaw-Triggered Flow](#openclaw-triggered-flow)
- [Obsidian Plugin Spec](#obsidian-plugin-spec)
  - [Slash Command Registration](#slash-command-registration)
  - [Streaming Into a Callout](#streaming-into-a-callout)
  - [Status Indicators](#status-indicators)
  - [Vault Awareness Features](#vault-awareness-features)
  - [Settings](#settings)
- [CLI Spec: `zettelclaw ask`](#cli-spec-zettelclaw-ask)
  - [Subcommands](#subcommands)
  - [Context Assembly](#context-assembly)
  - [Agent Invocation](#agent-invocation)
  - [Output Protocol](#output-protocol)
  - [File Mutation](#file-mutation)
- [Context Assembly Pipeline](#context-assembly-pipeline)
  - [Context Sources (Ranked)](#context-sources-ranked)
  - [Token Budget](#token-budget)
  - [System Prompt Template](#system-prompt-template)
- [OpenClaw Integration](#openclaw-integration)
  - [Shared Vault as Agent Memory](#shared-vault-as-agent-memory)
  - [OpenClaw Memory Path Registration](#openclaw-memory-path-registration)
  - [Cron-Scheduled Agent Tasks](#cron-scheduled-agent-tasks)
  - [Skill Publishing via ClawHub](#skill-publishing-via-clawhub)
- [Skill Integration](#skill-integration)
  - [SKILL.md Additions](#skillmd-additions)
  - [Agent-Agnostic Invocation](#agent-agnostic-invocation)
- [File Watcher Daemon](#file-watcher-daemon)
- [Callout Rendering](#callout-rendering)
  - [CSS Snippet](#css-snippet)
  - [Folding Behavior](#folding-behavior)
- [Error Handling](#error-handling)
- [Security and Privacy](#security-and-privacy)
- [Prerequisites](#prerequisites)
- [Future Plugin Capabilities](#future-plugin-capabilities)
- [Open Questions](#open-questions)

---

## Context: What Zettelclaw Is

Zettelclaw is a shared human + agent vault system. It consists of four components that work together:

| Component | What it is | Where it lives |
|---|---|---|
| **Vault template** | Pre-configured Obsidian vault with typed notes, frontmatter conventions, queue workflows, and templates | `~/zettelclaw/` (user's machine) |
| **CLI** (`zettelclaw`) | Bun-based tool for vault setup, plugin management, verification, and agent orchestration | `packages/cli` → npm |
| **Skill** (`@zettelclaw/skill`) | SKILL.md that teaches any agent how to read, search, and operate within the vault | `packages/skill` → ClawHub + npm |
| **Obsidian plugin** | UI layer inside Obsidian for agent interactions — slash commands, streaming responses, vault-aware features | `packages/plugin` (this spec) |

The vault is the shared medium. The human writes notes in it. The agent reads, searches, and surfaces insights from it. The CLI handles setup and orchestration. The skill teaches agents the conventions. The plugin provides in-app UX for the interaction.

### The Zettelclaw Stack

```
┌─────────────────────────────────────────────────────────┐
│                    Human (writes)                        │
│                                                         │
│  Obsidian app                                           │
│  ├── Zettelclaw vault (typed notes, templates, queues)  │
│  └── Zettelclaw plugin (slash commands, agent UI)       │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │
                    ┌─────┴─────┐
                    │           │
               ┌────┴────┐ ┌───┴────┐
               │zettelclaw│ │OpenClaw│
               │  CLI     │ │  agent │
               └────┬────┘ └───┬────┘
                    │          │
              ┌─────┴──────────┴─────┐
              │                      │
         ┌────┴────┐          ┌──────┴──────┐
         │  QMD    │          │ SKILL.md    │
         │ search  │          │ (vault      │
         │ engine  │          │  conventions)│
         └─────────┘          └─────────────┘
```

---

## Where the Plugin Fits

Today, Zettelclaw's agent interaction happens entirely outside Obsidian — in the terminal via CLI agents, or in the background via OpenClaw cron jobs. The vault is the shared artifact, but the conversation happens elsewhere.

The plugin brings the agent interaction **into Obsidian itself.** Instead of switching to a terminal to ask the agent a question about a note, the user types `/ask` inline and gets a response in-place.

But the plugin is not a standalone AI tool. It's one surface of the broader Zettelclaw system:

| Surface | How the agent interacts with the vault |
|---|---|
| **Terminal** (existing) | User runs `openclaw`, `claude`, `codex`, `opencode`, or `pi` in the vault directory. Agent uses SKILL.md. |
| **OpenClaw cron** (existing) | Scheduled agent tasks run in the background — vault maintenance, inbox processing, weekly reviews. |
| **Obsidian plugin** (this spec) | `/ask` command triggers agent queries from within notes. Responses stream into callouts. |
| **File watcher** (this spec) | `zettelclaw watch` daemon auto-answers `> [!ask]` callouts without Obsidian open. |

All four surfaces share the same skill, the same vault conventions, and the same QMD search layer. The plugin adds UX convenience, not new capability.

---

## Design Principles

**Human writes, agent reads.** The vault is the human's externalized thinking. The agent is a reader, navigator, and synthesizer — not a ghostwriter. The `/ask` callout is the controlled exception where the agent writes into the vault, but even here the human initiates and the agent's output is visually distinct.

**OpenClaw-first with fallbacks.** Zettelclaw integrates directly with OpenClaw as its primary agent runtime. The vault is registered as an OpenClaw memory path during `zettelclaw init`, the skill is published to ClawHub, and cron jobs handle scheduled vault maintenance. When OpenClaw is not available, the system falls back through a resolution chain — `openclaw` → `claude` → `codex` → `opencode` → `pi` — using whichever agent CLI the user has installed. The callout protocol, context assembly, and SKILL.md conventions are agent-agnostic, so the experience is consistent regardless of which agent answers.

**Markdown-native.** The entire protocol is standard Obsidian-flavored markdown. No custom file formats, no databases, no hidden state. A vault with ask/agent callouts is fully portable.

**Thin plugin, thick CLI.** The plugin handles only UI concerns (~200 lines). All intelligence — context assembly, QMD search, agent dispatch, file mutation — lives in the `zettelclaw` CLI. This keeps the plugin stable across Obsidian API changes and lets every trigger surface (plugin, watcher, terminal, cron) share the same logic.

---

## Plugin Overview

### Plugin Responsibilities

The Zettelclaw Obsidian plugin provides:

1. **`/ask` slash command** — inline agent queries with streaming responses (the core of this spec)
2. **Callout rendering** — custom CSS for `[!ask]` and `[!agent]` callouts
3. **Status indicators** — status bar feedback during agent processing
4. **Command palette actions** — "Ask agent", "Answer all pending asks", "Refresh last answer"
5. **Settings UI** — plugin configuration (CLI path, timeouts, defaults)

### What the Plugin Does Not Do

- Call any LLM API directly
- Manage API keys or authentication
- Run QMD searches or assemble context
- Parse vault structure or read frontmatter
- Decide which agent to use
- Schedule or manage cron jobs (OpenClaw handles this)
- Handle vault initialization or verification (CLI handles this)

The plugin is a UI shell. It spawns `zettelclaw ask` and renders the results.

---

## The `/ask` Command

### Callout Protocol

The ask/agent callout pair is the markdown contract between human and agent. It uses standard Obsidian callout syntax — no custom plugins required to render them.

### The Ask Callout

The human writes this. It's the prompt.

```markdown
> [!ask]
> What connections exist between spaced repetition and my notes on learning theory?
```

**Rules:**
- Standard Obsidian callout with type `ask`
- Can contain multiple lines, wikilinks, tags, or any markdown
- Optional title: `> [!ask] For my research project` — provides additional context
- The ask callout is the human's artifact — the agent never modifies it

### The Agent Callout

The agent writes this. It's the response.

```markdown
> [!agent]- 2026-03-03 · openclaw · 4 sources
> Based on your vault, there are three key connections...
>
> 1. **[[Spaced Repetition Systems]]** directly implements the spacing effect described in [[Learning Theory Foundations]] — both notes reference Ebbinghaus's forgetting curve but from different angles.
>
> 2. Your note [[Retrieval Practice]] bridges them — it argues that spaced repetition works *because* of active retrieval, not just temporal spacing. This contradicts [[Passive Review Is Sufficient]], which you tagged `#contradiction`.
>
> 3. [[Leitner System]] in your Projects folder is an implementation of these principles but doesn't link back to either theory note.
>
> **Suggested actions:**
> - Link [[Leitner System]] → [[Spaced Repetition Systems]]
> - Consider promoting [[Retrieval Practice]] from `seedling` to `budding` — it's well-developed
```

**Rules:**
- Type is `agent`
- Default collapsed (`-` suffix) so it doesn't dominate the note
- Title line contains: date, agent name, source count
- Body can contain wikilinks to vault notes the agent found
- Body can contain suggested actions (the human decides whether to act)
- Inserted immediately after the corresponding `> [!ask]` block
- Separated from the ask callout by exactly one blank line

### Lifecycle States

```
[pending]  →  [processing]  →  [answered]
```

| State | What it looks like |
|---|---|
| **Pending** | `> [!ask]` exists with no `> [!agent]` below it |
| **Processing** | `> [!agent]- Processing...` placeholder (streaming in progress) |
| **Answered** | `> [!agent]-` with full response content |

Detection: scan for `> [!ask]` blocks and check whether the next non-blank line starts with `> [!agent]`. If not, it's pending.

### Examples

**Simple question:**

```markdown
Some notes about distributed systems...

> [!ask]
> What did I write about CAP theorem trade-offs?

> [!agent]- 2026-03-03 · openclaw · 2 sources
> You have two relevant notes:
> - [[CAP Theorem]] discusses the impossibility result and your preference for AP systems
> - [[Distributed Database Selection]] applies CAP to your project's tech stack, choosing eventual consistency
```

**Question with wikilinks for context:**

```markdown
> [!ask] For [[Project Zettelclaw]]
> How do the vault design principles in [[Steph Ango's Vault]] compare to what [[James Bedford]] recommends?

> [!agent]- 2026-03-03 · openclaw · 3 sources
> The main divergence is in folder structure...
```

**Multi-paragraph question:**

```markdown
> [!ask]
> I've been thinking about how to handle the tension between atomic notes
> and project documentation. Atomic notes want to be small and focused,
> but project docs need to be comprehensive.
>
> What patterns in my vault have worked for bridging this?
```

**Refreshing a previous answer:**

```markdown
> [!ask]
> What are my active projects?

> [!agent]- 2026-02-15 · openclaw · 5 sources
> (previous answer, now stale)

> [!agent]- 2026-03-03 · openclaw · 7 sources
> (fresh answer appended below, previous one remains as history)
```

---

## System Architecture

### Full Stack Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                          Obsidian                                │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Note.md                                                  │   │
│  │                                                           │   │
│  │  > [!ask]                                                 │   │
│  │  > What connects X to Y?                                  │   │
│  │                                                           │   │
│  │  > [!agent]- 2026-03-03 · openclaw · 3 sources            │   │
│  │  > The connections are...  ← streaming tokens here        │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┴───────────────────────────────┐   │
│  │  Zettelclaw Plugin (thin UI bridge)                       │   │
│  │  • /ask slash command                                     │   │
│  │  • Spawns zettelclaw CLI, reads streaming stdout          │   │
│  │  • Writes tokens into editor via CM6 transactions         │   │
│  │  • Status bar: "Asking agent..." / "Done (3.2s)"          │   │
│  └───────────────────────────┬───────────────────────────────┘   │
└──────────────────────────────┼───────────────────────────────────┘
                               │ child_process.spawn
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  zettelclaw CLI (Bun)                                            │
│                                                                  │
│  zettelclaw ask:                                                 │
│  1. Parse question from stdin, --question, or pending callout    │
│  2. Read source note for local context                           │
│  3. Query QMD for vault-wide relevant content ─────────────────┐ │
│  4. Assemble context: note + QMD results + linked notes        │ │
│  5. Build prompt using SKILL.md conventions                    │ │
│  6. Invoke configured agent ─────────────────────────────────┐ │ │
│  7. Stream response to stdout (plugin reads this)            │ │ │
│                                                              │ │ │
│  Also handles: init, plugins, verify, watch                  │ │ │
└──────────────────────────────────────────────────────────────┼─┼─┘
                                                               │ │
┌──────────────────────┐  ┌────────────────────────────────────┘ │
│  QMD (search engine) │  │                                      │
│                      │◄─┘  ┌───────────────────────────────────┘
│  • BM25 keyword      │     │
│  • Semantic vectors   │     ▼
│  • Hybrid + reranking │  ┌──────────────────────────────────────┐
│                      │  │  Agent CLI                            │
│  Collections:        │  │                                      │
│  • zettelclaw-vault  │  │  Primary: OpenClaw                   │
│    -inbox            │  │  ├── Workspace: ~/.openclaw/workspace │
│    -notes            │  │  ├── Memory: vault registered in      │
│    -journal          │  │  │   agents.defaults.memorySearch.    │
│                      │  │  │   extraPaths                        │
│                      │  │  ├── Skill: @zettelclaw/skill from    │
└──────────────────────┘  │  │   ClawHub                          │
                          │  └── Cron: scheduled vault tasks      │
                          │                                      │
                          │  Fallbacks: claude → codex →         │
                          │  opencode → pi                       │
                          └──────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Component | Does | Doesn't |
|---|---|---|---|
| **UI** | Obsidian plugin | Slash commands, streaming display, status bar, CSS | AI logic, search, context assembly, agent selection |
| **Orchestration** | `zettelclaw` CLI | Context assembly, agent dispatch, file mutation, QMD queries | LLM inference, Obsidian API calls |
| **Search** | QMD | Semantic + BM25 search, collection indexing | Inference, file mutation |
| **Agent runtime** | OpenClaw (primary); claude/codex/opencode/pi (fallbacks) | LLM inference, memory management (OpenClaw), cron scheduling (OpenClaw) | Vault structure, UI |
| **Skill** | SKILL.md | Teaches agents vault conventions, note types, search patterns | Execution logic |

---

## Data Flow

### Plugin-Triggered Flow

The smoothest UX. User types `/ask` in Obsidian.

```
1. User types "/ask What connects X to Y?" in editor
2. Plugin's EditorSuggest captures the text after "/ask"
3. Plugin replaces the line with:
     > [!ask]
     > What connects X to Y?
     (blank line)
     > [!agent]- Processing...
     >
4. Plugin spawns: zettelclaw ask --question "What connects X to Y?"
                                 --file "/path/to/current/note.md"
                                 --vault "/path/to/vault"
                                 --stream
5. CLI runs context assembly (QMD search, note reading)
6. CLI invokes configured agent, streams response to stdout
7. Plugin reads stdout chunks, replaces "Processing..." content:
     > [!agent]- 2026-03-03 · openclaw · 3 sources
     > The connections are... (streaming token by token)
8. On stream end, plugin updates status bar: "Done (3.2s)"
```

### Watcher-Triggered Flow

Hands-free. User writes the callout manually, saves the file, walks away.

```
1. User writes in note:
     > [!ask]
     > What connects X to Y?
2. User saves file
3. zettelclaw watch (running as daemon) detects file change
4. Daemon scans changed file for pending [!ask] blocks
5. For each pending ask, daemon runs:
     zettelclaw ask --file "/path/to/note.md"
                    --line 42
                    --vault "/path/to/vault"
6. CLI assembles context, invokes agent
7. CLI writes the [!agent] callout directly into the file
8. Obsidian hot-reloads the file, user sees the response
```

### Manual CLI Flow

Terminal-first. User runs the command directly.

```
# Answer all pending asks in the vault
zettelclaw ask --vault ~/zettelclaw

# Answer a specific question, write to today's daily note
zettelclaw ask --question "What are my active projects?" --vault ~/zettelclaw

# Interactive: ask from terminal, print response (no file mutation)
zettelclaw ask --question "Summarize my notes on X" --vault ~/zettelclaw --stdout
```

### OpenClaw-Triggered Flow

The agent initiates. OpenClaw can answer pending asks as part of its scheduled vault maintenance — the same cron infrastructure Zettelclaw already uses for background tasks.

```
1. OpenClaw cron job runs (e.g., daily at 7am)
2. Job's prompt includes: "Check for pending [!ask] callouts in the vault"
3. OpenClaw agent searches vault for unanswered asks (via QMD or ripgrep)
4. For each pending ask, agent reads the surrounding note for context
5. Agent writes the [!agent] callout into the file
6. Changes appear next time the user opens Obsidian
```

This means asks written on a phone (via Obsidian Sync) or before bed get answered by the time the user sits down to work. The cron job reuses the existing `openclaw-jobs.ts` scheduling infrastructure in the CLI:

```typescript
// Example: schedule a daily ask-answering job
await scheduleAgentCronJob({
  name: 'zettelclaw-answer-asks',
  expression: '0 7 * * *',  // daily at 7am
  message: 'Search the vault for unanswered > [!ask] callouts and answer them.',
  workspace: openclawWorkspace,
})
```

---

## Obsidian Plugin Spec

### Slash Command Registration

Uses Obsidian's `EditorSuggest` API to intercept `/ask` as a trigger:

```typescript
class AskSuggest extends EditorSuggest<string> {
  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line)
    if (!line.startsWith('/ask ')) return null
    return {
      start: { line: cursor.line, ch: 0 },
      end: cursor,
      query: line.slice(5),
    }
  }
}
```

The trigger fires when the user types `/ask ` followed by their question. On Enter:
1. Replaces the `/ask ...` line with the ask callout
2. Inserts a processing placeholder
3. Spawns the CLI

Alternative trigger: a command palette action ("Zettelclaw: Ask agent") that opens a small modal for the question.

### Streaming Into a Callout

The main technical challenge. Callout lines must be prefixed with `> `.

```typescript
async streamIntoCallout(
  editor: Editor,
  startPos: EditorPosition,
  process: ChildProcess,
) {
  let buffer = ''
  let currentPos = { ...startPos }

  for await (const chunk of process.stdout) {
    const text = chunk.toString()
    // Prefix newlines with callout continuation
    const formatted = text.replace(/\n/g, '\n> ')
    editor.replaceRange(formatted, currentPos)
    // Advance cursor position
    buffer += formatted
    currentPos = editor.offsetToPos(
      editor.posToOffset(startPos) + buffer.length
    )
  }
}
```

Edge cases:
- User scrolls away during streaming: plugin uses absolute offsets, not cursor position
- User edits the note during streaming: plugin cancels gracefully, leaves partial response with "cancelled" note
- Newlines mid-token: `\n` → `\n> ` replacement handles callout continuation

### Status Indicators

- **Status bar (left):** "Asking agent..." with a spinner while processing, "Done (3.2s)" on completion
- **Callout title line:** Updates from `Processing...` to `2026-03-03 · openclaw · 3 sources` on completion
- **Error state:** `> [!agent]- Error` with the error message

### Vault Awareness Features

Beyond `/ask`, the plugin can surface vault-level information from the Zettelclaw system:

| Feature | What it does | Implementation |
|---|---|---|
| **Pending ask count** | Shows badge with count of unanswered asks across vault | Periodic scan or watcher notification |
| **Ask history** | Command to list recent ask/agent pairs across all notes | Glob + parse |
| **Agent status** | Shows which agent is configured and whether it's reachable | `zettelclaw verify --json` |

These are secondary to `/ask` and can ship later.

### Settings

| Setting | Default | Description |
|---|---|---|
| `zettelclawPath` | `zettelclaw` (PATH lookup) | Path to the zettelclaw CLI binary |
| `defaultCollapsed` | `true` | Whether agent responses are collapsed by default |
| `showTimestamp` | `true` | Include date in the agent callout title |
| `timeout` | `120` (seconds) | Max time before killing the agent process |

The plugin does **not** have settings for agent selection, API keys, or context strategies — those are configured via the CLI or OpenClaw workspace.

---

## CLI Spec: `zettelclaw ask`

### Subcommands

```
zettelclaw ask [options]
  Answer pending ask callouts or pose a new question.

Options:
  --question <text>    Ask a specific question (skips scanning for callouts)
  --file <path>        Target a specific note (default: scan vault for pending asks)
  --line <number>      Target a specific ask callout by line number
  --vault <path>       Vault root (default: auto-detect from cwd or config)
  --agent <name>       Override configured agent (openclaw|claude|codex|opencode|pi)
  --stream             Stream response to stdout (for plugin piping)
  --stdout             Print response only, don't write to file
  --dry-run            Show assembled context without invoking agent
  --verbose            Show context assembly details

zettelclaw watch [options]
  Watch vault for new ask callouts and answer them automatically.

Options:
  --vault <path>       Vault root
  --debounce <ms>      Wait time after file change (default: 1000)
  --agent <name>       Override configured agent
```

### Context Assembly

When the CLI receives a question, it assembles context:

```
1. Read the source note (the file containing the ask callout)
2. Extract wikilinks from the ask callout itself → prioritize these
3. Extract wikilinks from the source note → read linked notes
4. Query QMD with the question text → get ranked vault snippets
5. Read the note's parent MOC (from `up:` frontmatter)
6. Assemble into a structured context payload with token budget
```

### Agent Invocation

The CLI spawns the user's configured agent CLI as a subprocess. It doesn't call an LLM API directly. If no agent is explicitly configured, the CLI resolves the first available agent from the fallback chain:

```typescript
const AGENT_FALLBACK_CHAIN = ['openclaw', 'claude', 'codex', 'opencode', 'pi'] as const

// Use explicit config, or resolve first available agent from PATH
const agent = config.agent ?? await resolveAgent(AGENT_FALLBACK_CHAIN)

const prompt = buildPrompt(question, context)

const proc = spawn(agent, agentFlags(agent, prompt), {
  cwd: vaultPath,
  env: { ...process.env },
})
```

`resolveAgent()` checks each agent in order via `which` / PATH lookup and returns the first one found. This means the system works out of the box with whatever agent the user has installed — OpenClaw users get OpenClaw, Claude Code users get Claude, etc.

Agent adapter flags:

| Agent | Flag | Notes |
|---|---|---|
| `openclaw` | `--run` | Primary. Run mode with exit. Full memory/cron integration. |
| `claude` | `--print` | Fallback. Prints response and exits. |
| `codex` | `--prompt` | Fallback. Single-prompt mode. |
| `opencode` | TBD | Fallback. Varies by version. |
| `pi` | TBD | Fallback. Single-prompt mode. |

Adding a new agent is one adapter function — define its non-interactive flag and add it to the chain.

### Output Protocol

When invoked with `--stream`, the CLI streams to stdout with simple framing:

```
---zettelclaw-meta---
agent: openclaw
date: 2026-03-03
sources: 3
---zettelclaw-body---
Based on your vault, there are three key connections...
(streaming tokens follow)
---zettelclaw-end---
```

The plugin parses the meta block for the callout title, then streams the body into the editor.

Without `--stream` (watcher or manual mode), the CLI writes directly to the file.

### File Mutation

When writing to a file:

1. Read the full file content
2. Locate the target `> [!ask]` block (by line number or scanning)
3. Find the insertion point (first blank line after the ask block)
4. Construct the `> [!agent]-` callout with proper `> ` prefixing
5. Write atomically (temp file + rename) to prevent Obsidian from seeing partial content

---

## Context Assembly Pipeline

### Context Sources (Ranked)

Assembled in priority order, each with a token allocation:

| Priority | Source | How | Token allocation |
|---|---|---|---|
| 1 | **The question itself** | Parsed from callout | ~100 tokens |
| 2 | **Source note** | Read the file containing the ask callout | ~2,000 tokens |
| 3 | **Explicitly linked notes** | Wikilinks in the ask callout (e.g., `[[Note A]]`) | ~1,000 tokens each |
| 4 | **QMD hybrid search** | `qmd query "<question>" --json` against vault collection | ~4,000 tokens (top 5-10 results) |
| 5 | **Parent MOC** | From `up:` frontmatter of source note | ~1,000 tokens |
| 6 | **Backlinks to source note** | Via `obsidian backlinks` CLI or file scanning | ~1,000 tokens |
| 7 | **System prompt** | Vault conventions from SKILL.md | ~500 tokens |

### Token Budget

Default: ~12,000 context tokens. Configurable. The CLI fills sources in priority order until the budget is exhausted.

For each note included:
- Frontmatter (always — cheap, high signal)
- `>[!summary]` callout if present (fast relevance signal)
- Full body only if budget allows, otherwise truncated

This aligns with the primitive ranking from the [methodologies research](/docs/knowledge-management-methodologies.md#primitive-ranking-for-human-write-agent-read): frontmatter first, then summary callouts, then full content.

### System Prompt Template

```
You are an agent answering a question about the user's Zettelclaw vault.

## Your role
You are a research librarian — you know every note in the collection
and surface the ones most relevant to the question. You do not write
new knowledge; you help the human see what they already know.

## Vault conventions
This is a Zettelclaw vault with typed notes (evergreen, project,
research, contact, writing, journal), frontmatter metadata (type,
status, up, tags, created, updated), and queue workflows. Notes use
wikilinks for connections and >[!summary] callouts for quick relevance.

## Response format
- Use [[wikilinks]] when referencing vault notes (only link to notes
  that exist in the provided context)
- Be specific: quote or paraphrase the user's own words from their notes
- Suggest concrete actions (link these notes, promote this seedling,
  investigate this contradiction)
- Keep responses concise — aim for 100-300 words unless the question
  demands more

## Vault context
{assembled context here}

## Question
{question text}
```

---

## OpenClaw Integration

Zettelclaw already integrates with OpenClaw at the CLI level. The `/ask` command builds on this existing infrastructure.

### Shared Vault as Agent Memory

During `zettelclaw init`, the CLI registers the vault path in OpenClaw's configuration:

```json
// ~/.openclaw/openclaw.json (patched by zettelclaw init)
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "extraPaths": ["/Users/max/zettelclaw"]
      }
    }
  }
}
```

This means OpenClaw agents can already search the vault for context during any session — not just `/ask` queries. The vault functions as shared persistent memory between human and agent.

### OpenClaw Memory Path Registration

The `ensureOpenClawMemoryPath()` function in the CLI patches the config to add the vault without overwriting existing paths. This runs during `zettelclaw init` and `zettelclaw verify` confirms it:

```
$ zettelclaw verify --vault ~/zettelclaw
  ✓ Vault structure valid
  ✓ Plugins installed
  ✓ QMD collections indexed
  ✓ OpenClaw workspace found at ~/.openclaw/workspace
  ✓ OpenClaw memory extraPaths: vault path present
```

### Cron-Scheduled Agent Tasks

Zettelclaw's existing `openclaw-jobs.ts` infrastructure supports scheduling recurring agent tasks. The `/ask` system benefits from this for batch processing:

| Job | Schedule | What it does |
|---|---|---|
| `zettelclaw-answer-asks` | Daily at 7am | Answer all pending `> [!ask]` callouts |
| `zettelclaw-inbox-process` | Daily at 7am | Triage `00 Inbox/` items |
| `zettelclaw-stale-check` | Weekly | Flag notes with outdated references |
| `zettelclaw-orphan-scan` | Weekly | Find unlinked notes, suggest connections |

The answer-asks job means a user can write questions on their phone (via Obsidian Sync), and find answers waiting when they sit down at their desk.

### Skill Publishing via ClawHub

The `@zettelclaw/skill` package is published to both npm and ClawHub. OpenClaw loads skills from ClawHub natively. Fallback agents load the skill from the filesystem — Claude Code from `.claude/`, Codex from `~/.codex/skills/`, OpenCode from `~/.opencode/skills/`. The skill teaches all agents the same vault conventions, including the ask/agent callout protocol, regardless of how it's loaded.

Release pipeline (existing):
```
GitHub Release → npm publish (CLI + skill) → ClawHub publish (skill)
```

---

## Skill Integration

### SKILL.md Additions

The zettelclaw SKILL.md should be extended with the ask/agent callout protocol:

```markdown
## Ask/Agent callout protocol

The vault uses inline ask/agent callouts for human-agent Q&A:

- `> [!ask]` — human's question (never modify these)
- `> [!agent]-` — agent's response (collapsed by default)
- Agent callout title format: `date · agent-name · N sources`
- Use [[wikilinks]] to reference vault notes in responses
- Suggest actions but do not execute them
- When answering, search the vault first (QMD or ripgrep) and
  cite specific notes rather than generating from general knowledge
- If asked to answer pending asks, scan for [!ask] blocks without
  a corresponding [!agent] block below them
```

### Agent-Agnostic Invocation

The skill teaches any agent the callout format. Whether the user is running OpenClaw (primary) or claude/codex/opencode/pi (fallbacks), an agent that has loaded the skill can create proper ask/agent callout pairs. The CLI automates and optimizes this, but the convention works at the skill level alone — making the ask protocol functional even without the full Zettelclaw CLI.

---

## File Watcher Daemon

`zettelclaw watch` runs a background process monitoring the vault for new ask callouts.

```typescript
import { watch } from 'fs'

watch(vaultPath, { recursive: true }, async (event, filename) => {
  if (!filename?.endsWith('.md')) return

  clearTimeout(debounceTimers.get(filename))
  debounceTimers.set(filename, setTimeout(async () => {
    const pendingAsks = scanForPendingAsks(join(vaultPath, filename))
    for (const ask of pendingAsks) {
      await processAsk(ask)
    }
  }, debounceMs))
})
```

**Scanning for pending asks:**

```typescript
function scanForPendingAsks(filePath: string): PendingAsk[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const pending: PendingAsk[] = []

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('> [!ask]')) continue

    // Find end of ask block
    let end = i + 1
    while (end < lines.length && lines[end].startsWith('> ')) end++

    // Check if next non-blank line is an agent callout
    let next = end
    while (next < lines.length && lines[next].trim() === '') next++

    if (!lines[next]?.startsWith('> [!agent]')) {
      pending.push({
        file: filePath,
        line: i,
        question: extractQuestion(lines, i, end),
      })
    }
  }

  return pending
}
```

**Daemon lifecycle:**
- Start: `zettelclaw watch --vault ~/zettelclaw`
- Runs in foreground (background via launchd/systemd or `&`)
- Logs to `~/.zettelclaw/watch.log`
- Processes one ask at a time (queue) to avoid file conflicts
- Skips `.obsidian/`, `03 Templates/`, `04 Attachments/`

---

## Callout Rendering

### CSS Snippet

Bundled with the plugin (also available standalone as `zettelclaw-callouts.css`):

```css
/* Ask callout — human's question */
.callout[data-callout="ask"] {
  --callout-color: 168, 130, 255;  /* purple — human's voice */
  --callout-icon: lucide-help-circle;
}

/* Agent callout — AI response */
.callout[data-callout="agent"] {
  --callout-color: 130, 200, 160;  /* muted green — agent's voice */
  --callout-icon: lucide-brain;
  border-left-style: dashed;       /* visually distinct from human content */
  opacity: 0.9;                    /* slightly muted to signal non-human origin */
}
```

### Folding Behavior

Agent callouts use `-` suffix (`> [!agent]-`) to collapse by default:
- Writing flow isn't interrupted by long agent responses
- Title line (`2026-03-03 · openclaw · 3 sources`) is always visible
- Click to expand for full response
- Collapsed callouts take one line of vertical space

---

## Error Handling

| Error | Detection | Response |
|---|---|---|
| Configured agent not found | `spawn` ENOENT | CLI tries next agent in fallback chain (`openclaw` → `claude` → `codex` → `opencode` → `pi`). |
| QMD not installed | `spawn` ENOENT for `qmd` | CLI falls back to ripgrep-based search. Degraded but functional. |
| QMD collection not indexed | Empty results | CLI falls back to file-based search (linked notes + ripgrep). |
| Agent timeout | No output for `timeout` seconds | Plugin writes `> [!agent]- Timed out`. |
| Agent error | Non-zero exit code | Plugin writes `> [!agent]- Error: {message}`. |
| No vault detected | Can't find vault root | CLI exits with message about `--vault` flag. |
| File conflict (watcher) | File changed during write | CLI re-reads, re-locates ask block, retries once. |
| OpenClaw not configured | No workspace at expected path | CLI resolves next available agent from fallback chain (`claude` → `codex` → `opencode` → `pi`). |
| No agent CLI found | All agents in fallback chain missing | CLI exits with "No agent CLI found. Install one of: openclaw, claude, codex, opencode, pi." |

Graceful degradation: QMD unavailable → ripgrep → linked notes only → source note only → no context.

---

## Security and Privacy

**No API keys in the plugin.** Authentication is handled by the agent CLI — each agent manages its own credentials (OpenClaw workspace, Claude Code auth, Codex API key, etc.).

**Vault content stays local.** QMD runs locally. The only external call is the agent's LLM inference — the user controls which provider via their agent configuration.

**No telemetry.** The plugin and CLI collect no usage data.

**Scoped context.** The agent sees only the assembled context (source note, QMD results, linked notes) — not the entire vault per query. The context pipeline controls exposure.

**Atomic writes.** File mutations use temp-file + rename to prevent corruption. The watcher serializes writes to prevent race conditions.

---

## Prerequisites

| Requirement | Why | Install | Required? |
|---|---|---|---|
| **Zettelclaw vault** | Vault structure and conventions | `zettelclaw init` | Yes |
| **Zettelclaw CLI** | Orchestration layer | `bun install -g zettelclaw` | Yes |
| **QMD** | Vault search for context assembly | `bun install -g @tobilu/qmd` | Yes |
| **An agent CLI** | LLM inference | `openclaw` (primary), or `claude`, `codex`, `opencode`, `pi` | At least one required |
| **Obsidian 1.12+** | Plugin host + CLI integration | obsidian.md | For plugin use |

OpenClaw provides the richest integration (shared memory, cron scheduling, ClawHub skills). The fallback agents provide core `/ask` functionality without the scheduling and memory infrastructure. The system works without Obsidian open (CLI + watcher), without the plugin (terminal-only), and without OpenClaw (falls back to other agents). The full stack — plugin + CLI + OpenClaw + QMD — provides the smoothest experience.

---

## Future Plugin Capabilities

The plugin starts with `/ask` but could grow to surface more of the Zettelclaw system within Obsidian:

| Capability | Description | Priority |
|---|---|---|
| `/ask` slash command | Core of this spec | P0 — ship first |
| Callout CSS | Custom styling for ask/agent callouts | P0 — ship with `/ask` |
| Status bar | Agent processing feedback | P0 — ship with `/ask` |
| **Pending ask badge** | Count of unanswered asks across vault | P1 |
| **Ask history panel** | Sidebar listing recent Q&A pairs | P1 |
| **Agent health check** | Verify agent + QMD reachable from settings | P1 |
| **Vault maintenance status** | Show last cron run results | P2 |
| **Inbox triage assist** | Quick-action buttons on inbox items | P2 |
| **Link suggestion gutter** | Agent-suggested links shown as gutter hints | P3 |

Each capability follows the same pattern: thin UI in the plugin, logic in the CLI.

---

## Open Questions

**1. Re-asking.** If the user writes a new `> [!ask]` with the same question, should it replace the old answer or append a new one? Current spec says append (preserves history). But this could lead to answer accumulation.

**2. Conversation threads.** Should multiple ask/agent pairs in a single note share context? If I ask a follow-up, should the agent see the previous Q&A? (Likely yes — the source note context includes the full file.)

**3. Agent selection per question.** Should users specify the agent inline? E.g., `> [!ask] @codex` to override the default.

**4. Context preview.** Should the plugin surface the `--dry-run` output before invoking the agent?

**5. Cost visibility.** Should the callout title include token count or estimated cost?

**6. Refresh trigger.** How to re-answer? Options: delete the old `> [!agent]` block (watcher detects pending), or a `/refresh` command.

**7. Batch mode ordering.** `zettelclaw ask --vault` answers all pending asks. What priority order? (Newest first? By folder? By note status?)

**8. Obsidian CLI + QMD.** The Obsidian CLI handles structural queries (backlinks, tags). QMD handles semantic queries. Should context assembly use both?

**9. Response length.** Should the system prompt constrain response length, or let the agent decide?

**10. OpenClaw session continuity.** When answering via OpenClaw, should each ask be a fresh session or continue the workspace's running session? Fresh is simpler; continued shares cross-ask context.

**11. Headless sync.** With Obsidian Headless, the watcher could run on a server, answering asks from synced vaults. Worth speccing as a deployment mode?

**12. Plugin vs. community plugins.** Several existing plugins embed agent terminals in Obsidian (Claudian, Agent Client). How does the Zettelclaw plugin differentiate? Answer: it's vault-aware (understands Zettelclaw conventions, typed notes, callout protocol) rather than a generic agent terminal.
