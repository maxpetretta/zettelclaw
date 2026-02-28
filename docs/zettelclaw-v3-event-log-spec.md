# Zettelclaw V3: Event Log Architecture

Status: Draft → Revised
Date: 2026-02-28
Author: Research synthesis from 8 external sources + system redesign
Revised: 2026-02-28 — resolved open questions from implementation review

## 1. Problem Statement

Zettelclaw V1 is an Obsidian-first system with memory bolted on. The agent writes directly to human-readable Obsidian notes — typed, templated, frontmattered, QA-gated — and the prompt complexity exists to make the agent's output look good in Obsidian. This works, but the observability layer dominates the system's complexity:

- Migration sub-agent prompts are the longest files in the repo, mostly enforcing note formatting rules.
- Nightly maintenance is an LLM-heavy pass that audits note quality, enforces link reciprocity, and synthesizes inbox drafts.
- The hook prompt has 42 lines of rules about sections, headings, link-free output, and idempotency.
- The QA gates (word counts, claim-title validation, template compliance, YAML syntax enforcement) exist because the agent writes to the human's format, and that format is fussy.

V3 inverts the architecture. The agent writes to its own simple format — an append-only JSONL event log. Human observability is layered on top as an optional read transformation, not a write constraint on the agent.

```
V1:  Agent writes → Obsidian notes (human format)
V3:  Agent writes → JSONL log (agent format) → optional build step → Obsidian (human format)
```

The core system works without Obsidian. The log + MEMORY.md briefing + search is the complete memory system. Obsidian is an optional view layer for users who want to browse.

**V3 replaces OpenClaw's built-in memory system entirely.** It registers as a memory slot plugin (`plugins.slots.memory = "zettelclaw"`), replacing `memory-core`. This eliminates:
- Daily markdown notes (`memory/YYYY-MM-DD.md`) — the log replaces them
- The `session-memory` hook — zettelclaw's extraction hook replaces it
- The pre-compaction memory flush — zettelclaw extracts from full transcripts at session end
- The default `memory_search` and `memory_get` tools — zettelclaw provides its own, backed by the structured log

One memory system, not two.

## 2. Design Principles

Distilled from reviewing Berkay Ozcan, Vin (YouTube), Ramya Chinnadurai, Pedro/ClawVault, Nat Eliason, Ars Contexta, ClawVault repo, and James Bedford:

1. **The core is log + briefing + search.** Everything else is observability tax. Keep the tax low.

2. **Write discipline matters more than read discipline.** If decisions aren't flushed to disk before compaction or session end, no retrieval system recovers them. The write path must be trivially simple. (Ramya)

3. **Filter aggressively, structure lightly.** The hard content filter ("would I need to know this person to know this?") is more important than any formatting rule. A lean log of high-signal entries beats a large structured vault. (Synthesized)

4. **Capture and curation are separate concerns.** The extraction agent captures. The briefing generator curates. The human corrects. These happen at different times with different tools. (All sources)

5. **The human is the authority.** The log is observable (JSONL is text, grep-friendly, git-friendly). The briefing is readable. The Obsidian layer (when used) is browseable. The human can correct the agent by telling it ("that's wrong") and the correction enters the log as a first-class entry. (Bedford, Zettelclaw core)

6. **Non-destructive evolution.** The log is append-only. Corrections replace, they don't overwrite. The full history is always available. (Eliason, ClawVault)

7. **Decay is a read concern, not a storage concern.** The log doesn't decay. The briefing generator decides what's relevant based on recency, type, frequency, and open-loop status. Old entries fade from the briefing but remain searchable. (Eliason, ClawVault)

8. **Intent orientation matters as much as state orientation.** The agent needs to know not just what's happening (state) but why it matters (intent/goals/priorities). The human's manual section of MEMORY.md provides intent. The generated briefing provides state. (Bedford's Polaris concept)

## 3. Event Log

### 3.1 File Layout

```
~/.openclaw/zettelclaw/log.jsonl
~/.openclaw/zettelclaw/subjects.json
```

`log.jsonl` is a single append-only file. The extraction hook appends entries at session end. Ripgrep searches it directly. Git tracks it for history. One file is simpler than one-per-day — no date-based file routing, no glob patterns for queries, no directory to manage. A year of daily use produces a few thousand lines. Ripgrep handles millions.

`subjects.json` is a registry of known subject slugs. The extraction agent reads it before writing to ensure consistent slugs across sessions.

```json
{
  "auth-migration": { "display": "Auth Migration", "type": "project" },
  "whisper-stt": { "display": "Whisper STT", "type": "system" },
  "max": { "display": "Max", "type": "person" }
}
```

#### Subject contract

**Slug format:** Lowercase kebab-case. `auth-migration`, not `Auth_Migration` or `authMigration`.

**Creating subjects:** The extraction agent outputs entries with `subject` values. The extraction hook reads the registry before writing. If the LLM output references a slug not in the registry, the hook adds it to `subjects.json` with `display` (Title Case of slug) and `type` inferred from context (default `project`). Subjects can also be created manually via CLI:

```bash
openclaw zettelclaw subjects add auth-migration --type project
openclaw zettelclaw subjects add max --type person
```

**Renaming subjects:** CLI command renames in both the registry and the log:

```bash
openclaw zettelclaw subjects rename old-slug new-slug
```

This updates `subjects.json` and runs `sed` over `log.jsonl` to rewrite all occurrences. The log is a single file — renaming is a one-liner.

**Merging subjects:** Same as rename — rename the duplicate slug to the canonical one. The old slug is removed from the registry automatically.

**Deleting subjects:** Remove from `subjects.json`. Old log entries keep the slug but it won't be used for new entries.

### 3.2 Entry Types

Five types, each with a distinct query pattern:

| Type | What it captures | When to use |
|---|---|---|
| `task` | Something to do | Action items, follow-ups, blockers |
| `fact` | Something learned or observed | New information about the user, their projects, their environment. Includes preferences, events, observations, lessons, milestones, relationships. |
| `decision` | A choice was made with reasoning | Something changed direction or was committed to |
| `question` | An open loop | Something unresolved that needs an answer. Closes when replaced by a decision or fact. |
| `handoff` | Session boundary state | What's active, what's unresolved |

Corrections use the `replaces` field — a new entry points to the old one it replaces. Old entries are never modified — the log is strictly append-only. The resolver reads forward and builds a replacement map at query time.

### 3.3 Schema

#### Common fields (all entries)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | nanoid, 12 characters. **Generated programmatically by the extraction hook, not by the LLM.** |
| `timestamp` | string | yes | ISO 8601. **Injected by the extraction hook** at extraction time. The LLM does not produce timestamps. |
| `type` | string | yes | One of: `decision`, `fact`, `task`, `question`, `handoff`. |
| `content` | string | yes | The actual information. One sentence to a short paragraph. Plain text. |
| `session` | string | yes | OpenClaw `sessionId` (maps to `<sessionId>.jsonl` transcript file for provenance). **Injected by the extraction hook** from the event context. |
| `detail` | string | no | More information when content isn't enough. On a decision: why. On a fact: background. On a handoff: what happened. On a task: constraints. On a question: what prompted it. |
| `subject` | string | no | Slug from `subjects.json`. The specific thing this entry concerns — a project, person, system, tool. Must match an existing slug or be added to the registry during extraction. |
| `replaces` | string | no | ID of entry this replaces. The old entry is skipped by the resolver. |

`source` is intentionally omitted. The extraction agent writes all entries from session transcripts. Even when the human says "remember this," the agent extracts and writes it. The session ID provides provenance — if you need to know where an entry came from, look up the session. The transcript file lives at `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`.

#### Type-specific fields

**task** — something to do:

| Field | Required | Notes |
|---|---|---|
| `status` | yes | `"open"` or `"done"`. If blocked, it's still open — use `detail` for the reason. |

**fact** — something learned or observed:

```jsonl
{"id":"r7Wp3nKx_mZe","timestamp":"2026-02-20T14:35:00Z","type":"fact","content":"Exponential backoff caps at 3 retries with intervals 1s, 5s, 15s — total ~30s","subject":"auth-migration","session":"abc12345"}
```

**decision** — a choice with reasoning:

```jsonl
{"id":"a3k9x_BmQ2yT","timestamp":"2026-02-20T14:20:00Z","type":"decision","content":"Queue-based retries for webhook delivery instead of synchronous","detail":"Synchronous retries were cascading under load during the February auth outage","subject":"auth-migration","session":"abc12345"}
```

```jsonl
{"id":"Ht4vL_9qRx2D","timestamp":"2026-02-20T15:10:00Z","type":"task","content":"Write backfill script for 47 failed webhook jobs from last week","status":"open","subject":"auth-migration","session":"abc12345"}
```

**question** — an open loop:

No additional fields. Closes when replaced by a decision or fact.

```jsonl
{"id":"Jn2fR_7vKw4X","timestamp":"2026-02-20T15:15:00Z","type":"question","content":"Is the current retry strategy sufficient for webhook bursts over 10k/min?","subject":"auth-migration","session":"abc12345"}
```

**handoff** — session boundary state:

No type-specific fields. Uses `content` for the headline and `detail` for the full picture.

```jsonl
{"id":"Ym8kP_3wNx5Q","timestamp":"2026-02-20T15:30:00Z","type":"handoff","content":"Auth migration — retry logic implementation, backfill script not started","detail":"Exponential backoff working in staging. Still need backfill script for 47 failed jobs, then canary deploy. Load testing not done yet.","subject":"auth-migration","session":"abc12345"}
```

The handoff does not repeat decisions or tasks — those are already captured as separate entries from the same session. The briefing generator pulls them by session ID when it needs the full picture. The handoff's job is to summarize where things stand in prose.

#### Replacement examples

Correcting a decision:

```jsonl
{"id":"a3k9x_BmQ2yT","timestamp":"2026-02-20T14:20:00Z","type":"decision","content":"Queue-based retries for webhook delivery","detail":"Cascading failure risk","subject":"auth-migration","session":"abc12345"}
{"id":"Cx6tM_1pWn8Y","timestamp":"2026-02-26T10:00:00Z","type":"decision","content":"Queue-based retries with dead-letter queue for permanent failures","detail":"Discovered some failures are non-retryable, need a DLQ","subject":"auth-migration","replaces":"a3k9x_BmQ2yT","session":"def67890"}
```

Correcting a wrong fact:

```jsonl
{"id":"r7Wp3nKx_mZe","timestamp":"2026-02-20T14:35:00Z","type":"fact","content":"Exponential backoff intervals: 1s, 5s, 15s","subject":"auth-migration","session":"abc12345"}
{"id":"Dw9sN_2qXk7Z","timestamp":"2026-02-26T10:05:00Z","type":"fact","content":"Exponential backoff intervals: 2s, 10s, 30s","detail":"Previous entry had wrong intervals","replaces":"r7Wp3nKx_mZe","session":"def67890"}
```

The original entry is never modified. The replacement points back to it. The resolver reads forward and uses the latest version. Chains work: if A is replaced by B and B is replaced by C, the resolver uses C.

#### Replacement chain resolution

The resolver builds a `Map<id, replacedById>` in a single forward pass over the log. Any entry whose `id` appears as a key is superseded — skip it, use the replacement instead. At a few thousand entries this is <10ms. No index or cache needed for v1. Used by:

1. **Briefing generation** — to show only current versions of facts/decisions.
2. **CLI search** — to filter out superseded entries by default (add `--all` to include them).

### 3.4 Queryability

```bash
# All decisions
rg '"type":"decision"' log.jsonl

# Everything about a subject
rg '"subject":"auth-migration"' log.jsonl

# All open tasks
rg '"status":"open"' log.jsonl

# All open questions (not yet replaced)
rg '"type":"question"' log.jsonl

# Entries from a specific session
rg '"session":"abc12345"' log.jsonl

# Last handoff
rg '"type":"handoff"' log.jsonl | tail -1

# Full-text search
rg 'webhook' log.jsonl
```

### 3.5 Implicit Priority Signals

The log carries priority information without explicit scoring:

| Signal | How it works |
|---|---|
| **Type** | Decisions matter more than facts. Questions are open loops demanding attention. Tasks have status. |
| **Recency** | Recent entries matter more. The briefing windows filter by time. |
| **Frequency** | A subject with 30 entries this month is more active than one with 2. |
| **Replacement depth** | An entry replaced multiple times is actively refined — clearly important. |
| **Handoff presence** | The handoff entry captures what the user cared about at session end. |
| **Open-loop status** | Unanswered questions and open tasks are inherently high-priority until resolved. |

If these prove insufficient, a `pinned: true` boolean can be added later. Pinned entries always appear in the briefing regardless of age. One-field addition, no schema change.

### 3.6 Memory Decay

The log doesn't decay. It's append-only, immutable. Decay is a read concern.

The briefing generator applies natural decay through its time windows:

- Active subjects: entries in the last 14 days
- Recent decisions: last 7 days
- Open items: open tasks and unanswered questions (no time limit)
- Stale subjects: old entries about subjects referenced in recent sessions

If an entry isn't recent, isn't pending, and isn't being referenced — it doesn't show up in the briefing. It's still in the log, still findable by search. That's decay without deletion.

The time windows are the decay knobs. Tighten them and memory fades faster. Loosen them and more history stays visible.

Log compaction (merging old daily files into monthly summaries) is an eventual operational concern, not a memory concern.

## 4. Extraction

### 4.1 When extraction runs

Zettelclaw uses **OpenClaw plugin hooks** (not internal hooks) for extraction triggers. The plugin hook API provides richer context including `sessionId`, `sessionFile`, and `messages[]`.

| Trigger | Plugin hook | Context available | What happens |
|---|---|---|---|
| Session end (any cause) | `session_end` | `sessionId`, `messageCount`, `durationMs` | Primary trigger — fires on daily reset, idle reset, explicit `/new`/`/reset`, and any other session termination |
| Explicit reset | `before_reset` | `sessionFile`, `messages[]`, `sessionId`, `workspaceDir` | Fires before `/new`/`/reset` clears the session. Provides the full transcript inline via `messages[]`. |
| Gateway startup | `gateway_start` | — | Sweep for un-extracted sessions (catches crashes, restarts) |

**`session_end` is the primary extraction trigger.** It fires whenever a session ends, regardless of how — daily reset (default 4am), idle timeout, explicit `/new` or `/reset`. This eliminates the need for `message:received`-based session transition detection.

**`before_reset` is a secondary trigger** that provides immediate extraction with the full transcript already parsed as `messages[]` — no file I/O needed. If `before_reset` fires first and extracts successfully, the subsequent `session_end` for the same session is skipped via dedup.

**`gateway_start` sweep** catches edge cases: sessions that ended due to crashes, long inactivity, or gateway restarts where `session_end` never fired.

**Scope: main sessions only.** Only sessions with a human participant should produce log entries. The extraction hook checks the session key prefix and skips subagent sessions (`sub:*`), cron sessions (`cron:*`), and other non-interactive sessions. Only `agent:<agentId>:main` (and DM variants) are extracted.

### 4.1.1 Deduplication

The extraction hook maintains a state file at `~/.openclaw/zettelclaw/state.json`:

```json
{
  "extractedSessions": {
    "abc123def456": { "at": "2026-02-20T15:30:00Z", "entries": 7 },
    "def789ghi012": { "at": "2026-02-20T18:00:00Z", "entries": 3 }
  },
  "failedSessions": {
    "xyz999aaa111": { "at": "2026-02-21T10:00:00Z", "error": "LLM timeout", "retries": 1 }
  }
}
```

Before extracting, the hook checks if the `sessionId` is already in `extractedSessions`. If so, extraction is skipped. This prevents duplicate entries when both `before_reset` and `session_end` fire for the same session.

Failed extractions are recorded in `failedSessions` with retry count. The hook retries once on the next trigger. After one retry failure, the session is marked as permanently failed and skipped on subsequent triggers. The `gateway_start` sweep also retries failed sessions once.

The `extractedSessions` map is pruned periodically — entries older than 30 days are removed to keep the file small.

### 4.2 Extraction prompt

The extraction agent reads the conversation transcript and produces JSONL entries. The full prompt:

```markdown
You are the memory extraction agent. Read the conversation transcript below
and extract structured entries into the log.

## Entry types

- **task**: Something to do. Include status: open or done.
- **fact**: Something was learned. A piece of information specific to the user or their work.
- **decision**: A choice was made. Include what was decided and why (use the detail field).
  Includes preferences, observations, events, lessons — anything learned or observed.
- **question**: An open loop. Something unresolved that needs an answer.
- **handoff**: Session boundary. Exactly one per session, at the end. Records what's
  in-flight and what's unresolved. Don't repeat decisions or tasks already captured
  as separate entries — the handoff is for working state, not a session recap.

## Rules

1. Apply the hard filter: only extract information specific to this user.
   "Would I need to know this person to know this?" If a general LLM
   could produce it without user context, skip it.
2. One entry per fact/decision. Don't bundle multiple facts into one entry.
3. Content should be a single sentence to a short paragraph. Plain text.
4. Use the detail field when content alone isn't enough. Why a decision was made,
   background on a fact, what prompted a question, constraints on a task.
5. Use existing slugs from the provided subjects list when a match exists. If the
   entry concerns something genuinely new, use a new kebab-case slug — the hook
   will add it to the registry automatically. Don't force a subject on entries
   that aren't clearly about a specific thing.
6. Always produce exactly one handoff entry at the end.
7. Skip trivial exchanges (greetings, acknowledgments, clarifying questions
   that led nowhere).

## Output format

One JSON object per line. No markdown fences, no commentary.
**Do not include `id`, `timestamp`, or `session` fields** — these are injected
programmatically by the extraction hook after your output.

{"type":"decision","content":"...","detail":"...","subject":"..."}
{"type":"fact","content":"...","subject":"..."}
{"type":"task","content":"...","status":"open","subject":"..."}
{"type":"handoff","content":"...","detail":"..."}
```

~40 lines. Compare to V1's session-summary prompt + note quality rules + QA gates.

### 4.2.1 Post-processing by extraction hook

The extraction hook receives the LLM's JSONL output and for each line:

1. Parses the JSON object.
2. Validates `type` is one of the five allowed types.
3. Generates a 12-character nanoid for `id`.
4. Sets `timestamp` to the current ISO 8601 time.
5. Sets `session` to the OpenClaw `sessionId` from the hook event context.
6. If `subject` is present and not in `subjects.json`, adds it to the registry with `display` (Title Case) and `type` defaulting to `project`.
7. Appends the complete entry to `log.jsonl`.

### 4.3 Transcript access

The extraction hook accesses session transcripts differently depending on the trigger:

**On `before_reset`:**
1. The event provides `messages[]` (already parsed) and `sessionFile` path.
2. The hook filters `messages[]` for user/assistant messages directly — no file I/O needed.
3. `sessionFile` may point to a `.reset.*` rotated file; the hook handles this fallback (same pattern as the bundled `session-memory` hook).

**On `session_end`:**
1. The event provides `sessionId` but not `sessionFile` or `messages[]`.
2. The hook locates the transcript at `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` (or `.reset.*` variant).
3. Reads and parses the JSONL file, filtering for message entries.

**On `gateway_start` (sweep):**
1. The hook reads the session store (`sessions.json`) to find sessions not in `state.json`'s `extractedSessions`.
2. For each un-extracted session, it locates and reads the transcript file.
3. Also retries any sessions in `failedSessions` with `retries < 1`.

**Common to all triggers:**
- Messages are filtered for `type: "message"` entries with `role: "user"` or `role: "assistant"`.
- The extracted conversation text is passed to the LLM extraction prompt (model: Sonnet) along with the current `subjects.json` contents.

### 4.4 Hard content filter

The filter is the most important rule in the system. It applies at extraction time:

- "Would I need to know this person to know this?"
- If a general-purpose LLM could produce this content without user context, don't extract it.
- No general knowledge, no dependency lists, no version inventories, no boilerplate.
- Decisions, preferences, and user-specific facts pass. Generic information doesn't.

The filter keeps the log lean. A lean log means the briefing is high-signal and search results are relevant.

## 5. Briefing (MEMORY.md)

### 5.1 Two halves

MEMORY.md has two sections with different authors:

**Manual section (human/agent-written):** Goals, priorities, working preferences, identity context. The user's "Polaris" — intent and values that tell the agent why things matter. Persists until the human changes it. Not touched by the nightly job.

**Generated section (nightly-written):** Active subjects, recent decisions, pending items, stale subjects. The current state of the world derived from the log. Rewritten every night.

```markdown
## Goals
- Ship auth migration by end of month
- Keep the monorepo build under 30s
- Zettelclaw V3 spec and implementation

## Preferences
- Bun for all JS/TS, never yarn/pnpm
- Never auto-commit
- Prefer simple solutions over configurable ones

<!-- BEGIN GENERATED BRIEFING -->
## Active
- auth-migration — Queue-based retries implemented, backfill script pending
- zettelclaw — V3 event log spec in progress

## Recent Decisions
- 2026-02-20: Queue-based retries with exponential backoff for webhooks
- 2026-02-18: Bun over yarn — 3-4x faster, one-way door

## Pending
- Backfill script for 47 failed webhook jobs
- Canary deploy + 24h monitoring

## Open Questions
- Is retry strategy sufficient for 10k+/min webhook bursts?

## Stale
- whisper-stt — last entry 2026-01-08, referenced in recent session

## Contradictions
- auth-migration: "Synchronous retries with 5 max" (2026-02-10) may conflict with "Queue-based retries with 3 max" (2026-02-20)
<!-- END GENERATED BRIEFING -->
```

### 5.2 Generation

The nightly cron job reads recent log entries and rewrites the generated block:

1. **Active**: Collect unique `subject` values from entries in the last 14 days. For each, summarize the most recent entry.
2. **Recent Decisions**: All `type: "decision"` entries from the last 7 days.
3. **Pending**: All `type: "task"` with `status: "open"`. All `type: "question"` not yet replaced.
4. **Open Questions**: All `type: "question"` entries not replaced by a decision or fact.
5. **Stale**: Subjects whose most recent entry is older than 30 days but that appear in the `subject` field of entries from the last 7 days.
6. **Contradictions**: For each active subject, scan older unreplaced entries (decisions and facts) and compare against entries from the last 14 days. If an older entry appears to conflict with a newer one, flag it. The newer entry is assumed correct — the flag is asking the human to confirm the older entry should be replaced or dismissed.

Constraints:
- Max 80 lines between markers.
- Content outside markers is never touched.
- The generated block is the only part the nightly job writes to.
- Max 3 contradiction flags per nightly run to avoid noise.

### 5.3 Contract

MEMORY.md is auto-loaded into every OpenClaw session (first 200 lines). The manual section provides intent. The generated section provides state. Together they orient the agent without any search or file reads.

The log is authoritative. The briefing is a cache. When they disagree, the log wins.

**MEMORY.md is the only file from OpenClaw's default memory layout that survives.** Daily notes (`memory/YYYY-MM-DD.md`) are eliminated — the log replaces their function. MEMORY.md persists because it's auto-loaded by OpenClaw's session bootstrap (this behavior is independent of the memory plugin slot).

### 5.4 Retrieval Order

When the agent needs information beyond what MEMORY.md and the handoff provide, it uses the zettelclaw-provided memory tools:

1. **MEMORY.md** — auto-loaded by OpenClaw session bootstrap. Already in context.
2. **Last handoff** — auto-injected by `before_prompt_build` hook via `prependContext`. Already in context.
3. **`memory_search`** — zettelclaw's wrapped tool. Two search paths:
   - **Log search** (structured filters + ripgrep): precise lookups by type, subject, status. Keyword search over content/detail fields. Replacement-chain-aware.
   - **MEMORY.md search** (builtin semantic): delegated to OpenClaw's builtin for hybrid BM25+vector search over the manual section.
4. **`memory_get`** — zettelclaw's wrapped tool. Reads specific log entries by ID, MEMORY.md content, or transcript files by session ID (provenance lookups).

Each step is more expensive than the last. Most sessions should resolve from steps 1-2 (zero tool calls). Step 3 covers specific lookups and exploration. Step 4 is for deep dives into specific entries or original session transcripts when the log entry alone doesn't have enough context.

## 6. Session Handover

### 6.1 Handoff injection via `before_prompt_build`

On every agent turn, the `before_prompt_build` plugin hook fires before the system prompt is assembled. Zettelclaw registers on this hook, reads the most recent handoff entry from the log, and returns it as `prependContext` — which OpenClaw injects into the system prompt automatically. No file writes, no LLM call, runs in milliseconds.

The injected context looks like:

```
## Last Session Handoff
Session: abc12345 (2026-02-20T15:30:00Z)
Auth migration — retry logic implementation, backfill script not started
Detail: Exponential backoff working in staging. Still need backfill script for 47 failed jobs, then canary deploy. Load testing not done yet.
```

MEMORY.md provides the broad landscape (nightly briefing). The handoff injection provides the immediate context (real-time). They don't overlap.

### 6.2 Implementation note

The `before_prompt_build` hook fires on every agent run, not just session start. To avoid re-reading the log on every message, the handoff hook caches the last handoff entry in memory and only re-reads when the `sessionId` changes (new session) or the log file's mtime is newer than the cached value.

The hook can also pull recent decisions and tasks from the same session as the handoff (by matching `session` ID) to give fuller context without the handoff needing to repeat them.

```typescript
api.registerHook("before_prompt_build", async (event, ctx) => {
  const handoff = getCachedLastHandoff(logDir);
  if (!handoff) return;
  return {
    prependContext: formatHandoffContext(handoff),
  };
});
```

## 7. Obsidian Layer (Optional — deferred to v2)

> **Skipped for v1.** The Obsidian build step is a nice-to-have view layer. The core system (log + briefing + search + handoff) ships without it. This section is retained for future reference.

For users who want human-browseable memory in Obsidian, a separate build step renders the log into vault files. This is an optional add-on — the core system works without it.

### 7.1 What the build step generates

**Daily journals** — log entries grouped by date, rendered as markdown:

```markdown
---
type: journal
tags: [journals]
created: 2026-02-20
---
## Log
- Switched to queue-based retries for webhook delivery — cascading failure risk under load ([[Auth Migration]])
- Exponential backoff: 3 retries, intervals 1s/5s/15s, ~30s total

## Todo
- Backfill script for 47 failed webhook jobs ([[Auth Migration]])

## Questions
- Is retry strategy sufficient for 10k+/min bursts? ([[Auth Migration]])

---
## Sessions
- abc12345 — 15:30
  Auth migration — retry logic implementation, backfill script not started
```

**Topic pages** — entries grouped by `subject` value:

```markdown
---
tags: [projects]
created: 2026-02-15
updated: 2026-02-20
---
## Log
- 2026-02-20: Queue-based retries with exponential backoff, 3 max ([[2026-02-20]])
- 2026-02-18: Scoped migration plan — 3 phases, canary first ([[2026-02-18]])
- 2026-02-15: Post-mortem identified cascading retry failure ([[2026-02-15]])

## Pending
- Backfill script for 47 failed jobs
- Canary deploy + 24h monitoring

## Open Questions
- Is retry strategy sufficient for 10k+/min bursts?
```

Wikilinks, frontmatter, section structure — all injected by the build step. The agent wrote none of this.

### 7.2 Subject-to-display-name mapping

The build step reads the core `subjects.json` registry (see section 3.1) for display names and types. The `type` field determines naming conventions in the vault (projects get `Project` suffix, people get contact template, etc.). No separate registry — one file serves both the extraction agent and the build step.

### 7.3 Human corrections

The build step generates files append-only — it adds new entries at the bottom, never rewrites existing content. Human edits to existing content are preserved because the build step doesn't touch them.

If the human wants to correct a fact, they have two paths:
1. Tell the agent in conversation — the correction enters the log via normal extraction, with `replaces` pointing to the original entry.
2. Edit the journal or topic page directly — the edit persists because the build step only appends.

No two-way sync, no diff engine, no Obsidian plugin. The human's edits stick because the build step respects them.

### 7.4 Vault structure

```
<vault>/
  00 Inbox/          # Web clipper captures, human notes
  01 Notes/          # Build-step-generated topic pages
  02 Agent/          # OpenClaw workspace symlinks
  03 Journal/        # Build-step-generated daily journals
  04 Templates/      # Obsidian templates (optional)
  05 Attachments/    # Non-markdown files
```

## 8. OpenClaw Integration

### 8.1 Plugin structure

Distributed as a single OpenClaw **memory slot plugin** via npm. Declares `kind: "memory"` in its manifest, replacing `memory-core` when installed:

```
zettelclaw/
  package.json                    # npm package with openclaw.extensions
  openclaw.plugin.json            # Plugin manifest — kind: "memory", configSchema, etc.
  prompts/
    extraction.md                 # Extraction agent prompt (section 4.2)
    briefing.md                   # Briefing generation prompt for nightly cron
    contradiction.md              # Contradiction detection prompt for nightly cron
  src/
    plugin.ts                     # Plugin entry — registers hooks, tools, CLI commands
    hooks/
      extraction.ts               # session_end / before_reset / gateway_start — extract from transcripts
      handoff.ts                  # before_prompt_build — inject last handoff as prependContext
    tools/
      memory-search.ts            # Wraps builtin memory_search — adds structured filters + replacement resolution
      memory-get.ts               # Wraps builtin memory_get — adds entry-by-ID and transcript lookups
    briefing/
      generate.ts                 # Read log, run briefing prompt, rewrite MEMORY.md block
    log/
      schema.ts                   # Entry types, validation, nanoid generation
      resolve.ts                  # Replacement resolution (forward-pass Map<id, replacedById>)
      query.ts                    # Structured log queries (type/subject/status filters)
    subjects/
      registry.ts                 # Read/write subjects.json, auto-create, rename/merge
    state.ts                      # Dedup state (extractedSessions, failedSessions)
  skills/
    zettelclaw/
      SKILL.md                    # Teaches the agent about the memory system
```

Prompts are stored as standalone markdown files in `prompts/`, not inline in code. This makes them editable, reviewable, and versionable independently of the plugin logic.

### 8.1.1 Memory slot registration

The plugin manifest (`openclaw.plugin.json`) declares the memory slot:

```json
{
  "id": "zettelclaw",
  "name": "Zettelclaw",
  "kind": "memory",
  "configSchema": { ... }
}
```

On `init`, the plugin sets `plugins.slots.memory = "zettelclaw"` in the user's config. This:
- Disables `memory-core` (the default memory plugin)
- Disables the `session-memory` bundled hook (zettelclaw's extraction replaces it)
- Makes zettelclaw's `memory_search` and `memory_get` the active memory tools

The pre-compaction memory flush (`agents.defaults.compaction.memoryFlush`) is disabled by `init` since zettelclaw extracts from full transcripts at session end — no need for the model to self-save during compaction.

### 8.2 What the plugin registers

| Component | OpenClaw mechanism | Purpose |
|---|---|---|
| **Memory slot** | `kind: "memory"` in manifest | Replaces `memory-core` as the active memory plugin |
| **`memory_search` tool** | Wraps `api.runtime.tools.createMemorySearchTool()` | Builtin semantic/keyword search + structured log filters + replacement resolution |
| **`memory_get` tool** | Wraps `api.runtime.tools.createMemoryGetTool()` | Builtin file reads + log entry-by-ID + transcript lookups by session ID |
| Extraction hook | Plugin hook: `session_end` | Primary trigger — fires on any session end (daily/idle/explicit reset) |
| Extraction hook | Plugin hook: `before_reset` | Secondary — provides `messages[]` inline on `/new`/`/reset` |
| Extraction hook | Plugin hook: `gateway_start` | Sweep for un-extracted and failed sessions |
| Handover hook | Plugin hook: `before_prompt_build` | Inject last handoff as `prependContext` in system prompt |
| Nightly cron | `openclaw cron add` during init | Rewrite MEMORY.md briefing block (LLM-powered) |
| Skill | `skills/zettelclaw/SKILL.md` | Agent instructions for the memory system |
| CLI: init | Plugin-registered command | Create log directory, set memory slot, disable flush, register cron, add briefing markers to MEMORY.md |
| CLI: log | Plugin-registered command | Pretty-print recent log entries |
| CLI: search | Plugin-registered command | Search log with filters (type, subject, date range, `--all` for replaced) |
| CLI: subjects | Plugin-registered command | `add`, `rename`, `list` — manage subject registry |

### 8.3 Installation

```bash
openclaw plugins install zettelclaw
openclaw zettelclaw init
```

`init` does the following:
1. Creates the log directory (`~/.openclaw/zettelclaw/`) with empty `log.jsonl`, `subjects.json`, and `state.json`
2. Sets `plugins.slots.memory = "zettelclaw"` in config (replaces `memory-core`)
3. Disables `agents.defaults.compaction.memoryFlush` (zettelclaw handles persistence)
4. Disables the `session-memory` bundled hook if enabled
5. Registers the nightly cron job for briefing generation
6. Adds `<!-- BEGIN GENERATED BRIEFING -->` / `<!-- END GENERATED BRIEFING -->` markers to MEMORY.md

### 8.4 Configuration

In `openclaw.json` under `plugins.entries.zettelclaw`:

```json
{
  "enabled": true,
  "config": {
    "logDir": "~/.openclaw/zettelclaw",
    "extraction": {
      "model": "anthropic/claude-sonnet-4-6",
      "skipSessionTypes": ["cron:", "sub:", "hook:"]
    },
    "briefing": {
      "model": "anthropic/claude-sonnet-4-6",
      "activeWindow": 14,
      "decisionWindow": 7,
      "staleThreshold": 30,
      "maxLines": 80
    },

    "cron": {
      "schedule": "0 3 * * *",
      "timezone": "America/Detroit"
    }
  }
}
```

`logDir` contains `log.jsonl`, `subjects.json`, and `state.json`. All in one directory.

Search/embedding configuration is inherited from the user's existing `agents.defaults.memorySearch` settings — no separate search config needed. The builtin indexer handles MEMORY.md semantic search; log search is handled by the wrapper via structured filters + ripgrep.

### 8.5 Nightly cron job

Registered during `init`:

```bash
openclaw cron add \
  --name "zettelclaw-briefing" \
  --cron "0 3 * * *" \
  --tz "<user-timezone>" \
  --exact \
  --session isolated \
  --message "<briefing generation prompt>" \
  --timeout-seconds 300 \
  --no-deliver
```

The briefing generation prompt tells the agent to read the log and rewrite the MEMORY.md generated block. This is a short, focused task — read JSONL, write markdown. Should complete in under a minute.

If Obsidian mode is enabled, the cron job also runs the build step after the briefing.

## 9. Memory Tools (Replaces `memory-core`)

Zettelclaw registers as `kind: "memory"` and replaces `memory-core` in the plugin slot. It provides wrapped versions of the builtin `memory_search` and `memory_get` tools — same tool names, no agent prompt changes needed — with structured log awareness layered on top.

### 9.1 Architecture: wrapping the builtins

`memory-core` is a thin plugin that calls `api.runtime.tools.createMemorySearchTool()` and `createMemoryGetTool()` — these are builtin runtime functions that handle embedding, indexing, hybrid BM25+vector search, MMR, temporal decay, caching, and QMD support. The runtime helpers are always available regardless of which memory plugin is active.

Zettelclaw calls the same runtime helpers internally, then wraps the results with structured log awareness:

```typescript
register(api: OpenClawPluginApi) {
  api.registerTool((ctx) => {
    const builtinSearch = api.runtime.tools.createMemorySearchTool({
      config: ctx.config,
      agentSessionKey: ctx.sessionKey,
    });
    const builtinGet = api.runtime.tools.createMemoryGetTool({
      config: ctx.config,
      agentSessionKey: ctx.sessionKey,
    });

    return [
      wrapMemorySearch(builtinSearch, logDir),
      wrapMemoryGet(builtinGet, logDir),
    ];
  }, { names: ["memory_search", "memory_get"] });
}
```

**What this gives us:**
- All of OpenClaw's search infra for free (hybrid BM25+vector, MMR, temporal decay, embedding caching, QMD, local/remote embeddings)
- Structured filters on top (type, subject, status, replacement chain)
- Same tool names — existing agent prompts and system instructions work unchanged
- The builtin indexer handles `MEMORY.md` + any configured extra paths; zettelclaw adds `log.jsonl` to the indexed paths

### 9.2 `memory_search` (wrapped)

Extends the builtin schema with optional structured filters:

| Parameter | Type | Source | Description |
|---|---|---|---|
| `query` | string | Builtin | Required. Natural language or keyword query. |
| `maxResults` | number | Builtin | Optional. Max results to return. |
| `minScore` | number | Builtin | Optional. Minimum similarity score. |
| `type` | string | Zettelclaw | Optional. Filter by entry type (`fact`, `decision`, `task`, `question`, `handoff`). |
| `subject` | string | Zettelclaw | Optional. Filter by subject slug. |
| `status` | string | Zettelclaw | Optional. Filter tasks by status (`open`, `done`). |
| `includeReplaced` | boolean | Zettelclaw | Optional. Include superseded entries (default: false). |

**Execution flow:**
1. If structured filters are provided (`type`, `subject`, `status`), pre-filter log entries and return matching results directly (no embedding needed for precise structured queries).
2. If `query` is provided (with or without filters), delegate to the builtin `memory_search` for semantic + keyword search over indexed content.
3. Post-process results: parse any log entry matches to add structured metadata (`id`, `type`, `subject`, `timestamp`) and apply replacement chain resolution (filter out superseded entries unless `includeReplaced`).
4. Return merged results — structured log entries enriched with metadata alongside any MEMORY.md matches from the builtin.

**Indexing:** The builtin indexer only indexes Markdown files — it will not index `log.jsonl`. The search wrapper handles this split:
- **MEMORY.md semantic search** — delegated to the builtin (hybrid BM25+vector, MMR, temporal decay, all inherited).
- **Log search** — handled by the wrapper directly via structured filters (in-process JSONL parsing by type/subject/status) + ripgrep keyword search over `content` and `detail` fields. No vector index over log entries for v1.

This is sufficient because log entries are short, structured, and tagged — structured filters cover precise lookups ("all open tasks for auth-migration"), and ripgrep covers keyword searches ("webhook"). Semantic search adds the most value over MEMORY.md where content is longer and less structured. A vector index over log entries can be added in v2 if keyword + structured filters prove insufficient at scale.

### 9.3 `memory_get` (wrapped)

Extends the builtin with log entry and transcript lookups:

| Parameter | Type | Source | Description |
|---|---|---|---|
| `path` | string | Builtin | File path (e.g., `MEMORY.md`) or zettelclaw entry ID / session reference. |
| `from` | number | Builtin | Optional. Start line (for file reads). |
| `lines` | number | Builtin | Optional. Number of lines (for file reads). |

**Execution flow:**
1. If `path` is `MEMORY.md` or any file path — delegate to the builtin `memory_get` (backward compatible).
2. If `path` matches a 12-character nanoid pattern (e.g., `r7Wp3nKx_mZe`) — look up the log entry by ID in `log.jsonl` and return the full entry JSON with all fields.
3. If `path` starts with `session:` (e.g., `session:abc123def456`) — locate and read the transcript file at `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`, filtered to user/assistant messages. This is the provenance lookup — from a log entry's `session` field to the full conversation context.

### 9.4 What's eliminated

By replacing `memory-core`, zettelclaw eliminates:
- `memory/YYYY-MM-DD.md` daily notes — the log captures this information structurally
- The `session-memory` hook — extraction handles session persistence
- The pre-compaction memory flush — full transcripts survive on disk

**What's preserved** (via wrapping the builtin runtime helpers):
- Hybrid BM25 + vector search
- MMR re-ranking (diversity)
- Temporal decay (recency boost)
- Embedding caching (SQLite)
- QMD backend support
- Local and remote embedding providers
- All `agents.defaults.memorySearch` configuration

## 10. What We're Not Doing

**Obsidian-first architecture.** Obsidian is an optional view layer, not the primary storage. The log is the source of truth.

**Typed notes maintained by the agent.** The agent doesn't create evergreen notes, project notes, or contact notes. It writes log entries. The build step generates Obsidian files if the user wants them. The human can create their own notes in Obsidian — the agent reads them for context but doesn't maintain them.

**Scored observations** (ClawVault's `[type|c=confidence|i=importance]`). The implicit priority signals from the log (type, recency, frequency, replacement depth, handoff, open-loop status) are sufficient without explicit scoring.

**Context profiles** (ClawVault's planning/incident/handoff retrieval orderings). The MEMORY.md briefing + SessionStart handoff orient the agent for any task type.

**Temporal fact versioning** (ClawVault's `validFrom`/`validUntil`). Supersession handles corrections. Git history provides the audit trail.

**Maps of Content / MOC hierarchy** (Ars Contexta). The log is flat and searchable. The briefing surfaces what matters. MOCs solve a browsing problem that the build step handles if needed.

**Two-way sync between Obsidian and the log.** The build step appends to generated files. Human edits to existing content are preserved. No diff engines, no Obsidian plugins, no reconciliation. If the human wants to correct the agent's memory, they tell the agent.

**Access frequency tracking.** Adds circularity risk (entries in the briefing get "accessed" every session, staying hot forever). The implicit signals are sufficient. Can be added later if needed.

**Coexisting with `memory-core`.** Zettelclaw replaces the default memory plugin via the slot system. Running both would create conflicting tool registrations. One plugin owns the memory tools — zettelclaw.

**Reimplementing search infra.** The builtin embedding, indexing, hybrid search, MMR, temporal decay, and caching are battle-tested. Zettelclaw wraps them rather than reimplementing. The structured query layer (type/subject/status filters, replacement resolution) is the genuinely new capability.

**Daily markdown notes.** `memory/YYYY-MM-DD.md` is an artifact of `memory-core`. The structured log captures the same information with better queryability. MEMORY.md survives as the briefing surface.

**TOON format.** Token-efficient for tabular data in LLM prompts but worse than JSONL for semi-uniform event logs (+19.9% in TOON's own benchmarks). JSONL is universally parseable with zero dependencies.

## 11. Verification (v1 scope)

1. **Extraction (explicit)**: Run a substantive session. End with `/new`. Verify `log.jsonl` has new entries including one handoff. Verify entries have programmatically generated `id`, `timestamp`, and `session` fields. Verify the hard content filter excluded generic information.

2. **Extraction (session end)**: Have a session, let it expire (daily/idle reset). Verify `session_end` hook fires and extracts from the expired session's transcript.

3. **Extraction (startup sweep)**: Stop the gateway with an active un-extracted session. Restart. Verify `gateway_start` hook extracts from the stale session. Also verify failed sessions are retried.

4. **Deduplication**: Issue `/new` (triggers `before_reset` extraction), then verify the subsequent `session_end` for the same sessionId is skipped (state.json `extractedSessions` dedup).

4a. **Scope filtering**: Verify subagent, cron, and hook sessions are not extracted. Only main sessions with human participants produce log entries.

5. **Subject auto-creation**: Verify new subjects from extraction are added to `subjects.json`. Verify `openclaw zettelclaw subjects add` and `openclaw zettelclaw subjects rename` work correctly (rename updates both registry and log).

6. **Handover injection**: Start a new session. Verify the agent sees the last handoff context via `before_prompt_build` → `prependContext`. Check that it knows what was being worked on without searching.

7. **Nightly briefing**: Run `openclaw cron run <zettelclaw-briefing>`. Verify MEMORY.md's generated block is updated. Verify manual content outside the markers is preserved. Verify active subjects, recent decisions, pending items, and stale subjects are populated correctly from the log.

8. **Memory tools**: Verify `memory_search` returns structured log entries with type/subject/status filters. Verify keyword search over log entries works via ripgrep ("webhook" finds the retry decision). Verify semantic search over MEMORY.md works via the builtin. Verify `memory_get` reads entries by ID, MEMORY.md by path, and transcripts by `session:` prefix. Verify `memory-core` is disabled (slot occupied by zettelclaw).

8a. **CLI search**: Run `openclaw zettelclaw search --type decision --subject auth-migration`. Verify correct results. Verify `--all` includes replaced entries.

9. **End-to-end continuity**: Work across 3 sessions in one day. Verify each session starts with the previous session's handoff. Start a session the next morning after the nightly cron. Verify MEMORY.md briefing reflects all three sessions' activity.

10. **Replacement**: Tell the agent a previous fact was wrong. Verify the correction enters the log with `replaces` pointing to the original entry. Verify the next briefing reflects the corrected version. Verify replaced entries are hidden in default search results.

## Appendix A: Implementation Review Resolutions (2026-02-28)

Resolutions from review of the draft spec against OpenClaw's actual API surface:

| # | Question | Resolution |
|---|---|---|
| 1 | nanoid/timestamp generation | LLM outputs entries without `id`, `timestamp`, `session`. Hook injects all three programmatically. |
| 2 | Subject management | CLI commands `subjects add` and `subjects rename` (rename seds the log). Extraction hook auto-creates new subjects. |
| 3 | Timestamp source | Injected by hook at extraction time. Not LLM-generated. |
| 4 | Extraction triggers | Plugin hook API provides `session_end`, `before_reset`, `before_compaction`, `after_compaction`, `session_start` — richer than internal hooks. Primary: `session_end` (all session ends). Secondary: `before_reset` (provides `messages[]` inline). Sweep: `gateway_start`. Scope: main sessions only (skip subagents, cron, hooks). |
| 5 | Transcript access | `before_reset` provides `messages[]` inline; `session_end` provides `sessionId` for file lookup. Handle `.reset.*` rotation fallback. |
| 6 | Briefing generation | LLM-powered (summarization, contradiction detection). |
| 7 | Obsidian layer | Deferred to v2. |
| 8 | Replacement chain | Forward-pass `Map<id, replacedById>` at query time. Used by briefing gen and CLI search. No index for v1. |
| 9 | Session ID format | OpenClaw's `sessionId` from hook event context. Maps to `<sessionId>.jsonl` transcript. |
| 10 | Duplicate handoffs | `state.json` tracks `extractedSessions` map (set of sessionIds). Same session = skip. Failed sessions tracked with retry count (max 1 retry). Map pruned after 30d. |
| 11 | JSONL indexing | Builtin indexer is markdown-only. Log search handled by wrapper (structured filters + ripgrep). Semantic search covers MEMORY.md only for v1. |
| 12 | Handoff injection | `before_prompt_build` hook → `prependContext`. Cached in memory, re-read on session change or log mtime change. |
| 13 | Extraction model | Sonnet (configurable via `extraction.model`). |
| 14 | Scope filtering | Only main sessions extracted. Skip `cron:`, `sub:`, `hook:` session key prefixes. |
| 15 | Error handling | Retry extraction once on failure. Mark as permanently failed after second failure. `gateway_start` sweep also retries. |
| 16 | Migration from v1 | Clean break. Existing Obsidian vault stays as-is. No import tool for v1. |

## Appendix B: Build Order

Recommended implementation sequence. Each phase is independently testable.

### Phase 1: Core log + schema
- `log/schema.ts` — entry types, validation, nanoid generation
- `log/resolve.ts` — replacement chain resolution
- `log/query.ts` — structured filters (type/subject/status) + ripgrep wrapper
- `subjects/registry.ts` — read/write subjects.json, auto-create
- `state.ts` — extractedSessions/failedSessions tracking
- **Test:** Write entries manually to `log.jsonl`, query them, verify replacement resolution

### Phase 2: Extraction hooks
- `hooks/extraction.ts` — `session_end`, `before_reset`, `gateway_start` handlers
- `prompts/extraction.md` — extraction prompt (from spec section 4.2)
- Post-processing pipeline (parse LLM output → validate → inject id/timestamp/session → auto-create subjects → append to log)
- Dedup via state.json
- Scope filtering (main sessions only)
- Error handling (retry once, mark failed)
- **Test:** Run a real session, hit `/new`, verify log entries appear with correct fields

### Phase 3: Memory tools (wrapped)
- `tools/memory-search.ts` — wrap builtin, add structured filters + ripgrep log search + replacement resolution
- `tools/memory-get.ts` — wrap builtin, add entry-by-ID + session transcript reads
- Plugin manifest (`openclaw.plugin.json`) with `kind: "memory"`
- `plugin.ts` — register tools, hooks, CLI
- **Test:** Install plugin, verify `memory_search` with type/subject filters works, verify `memory_get` by entry ID works, verify `memory-core` is disabled

### Phase 4: Handoff injection
- `hooks/handoff.ts` — `before_prompt_build` handler, cached last handoff
- **Test:** End a session, start a new one, verify the agent sees the handoff context without searching

### Phase 5: Briefing generation
- `prompts/briefing.md` — briefing generation prompt
- `prompts/contradiction.md` — contradiction detection prompt
- `briefing/generate.ts` — read log, run LLM, rewrite MEMORY.md generated block
- Nightly cron registration
- **Test:** Run cron manually, verify MEMORY.md generated block reflects log state

### Phase 6: CLI + init
- CLI commands: `init`, `log`, `search`, `subjects add/rename/list`
- `init` flow: create log dir, set memory slot, disable flush, register cron, add markers
- SKILL.md — agent instructions for the memory system
- **Test:** Full `openclaw plugins install zettelclaw && openclaw zettelclaw init` flow

## Appendix C: OpenClaw Reference Materials

Source code and documentation referenced during spec development. Paths are relative to the OpenClaw npm package (`~/.local/share/mise/installs/node/22.22.0/lib/node_modules/openclaw/`).

### Documentation (docs/)

| File | Relevant to | Key content |
|---|---|---|
| `docs/concepts/memory.md` | §9 Memory tools | Memory file layout, `memory_search`/`memory_get` behavior, builtin indexer (markdown-only), QMD backend, hybrid search, MMR, temporal decay, `extraPaths`, pre-compaction flush config |
| `docs/concepts/session.md` | §4.1 Extraction triggers | Session lifecycle, daily reset (4am default), idle reset, `idleMinutes`, reset policy — "expiry is evaluated on the next inbound message" |
| `docs/concepts/compaction.md` | §4.1 (why no compaction hooks) | Compaction lifecycle, memory flush before compaction |
| `docs/automation/hooks.md` | §8.2 Plugin registration | Internal hook events: `command:new`, `command:reset`, `command:stop`, `gateway:startup`, `agent:bootstrap`, `message:received`, `message:sent`. Note: these are the *internal* hook events — plugin hooks have a richer API (see source below) |
| `docs/concepts/agent-workspace.md` | §5.3 MEMORY.md contract | Workspace layout, auto-loaded files, `MEMORY.md` first 200 lines |

### Source code (dist/)

| File | Relevant to | Key content |
|---|---|---|
| `dist/plugin-sdk/plugins/types.d.ts` | §4.1, §6, §8, §9 | **Full plugin hook type definitions.** All hook event shapes and contexts. Key types: `PluginHookSessionEndEvent` (`sessionId`, `messageCount`, `durationMs`), `PluginHookBeforeResetEvent` (`sessionFile`, `messages[]`, `reason`), `PluginHookBeforePromptBuildResult` (`prependContext`), `PluginHookBeforeCompactionEvent` (`sessionFile`), `PluginHookSessionStartEvent` (`sessionId`, `resumedFrom`). Also: `PluginKind = "memory"`, `OpenClawPluginApi.registerTool()`, `registerHook()`, `registerCli()` |
| `dist/plugin-sdk/plugins/hooks.d.ts` | §8.2 Hook runner | `createHookRunner()` return type — lists all available hook methods including `runSessionEnd`, `runBeforeReset`, `runBeforePromptBuild`, `runGatewayStart` |
| `extensions/memory-core/index.ts` | §9.1 Wrapping builtins | **Reference implementation.** 35 lines. Shows how `memory-core` calls `api.runtime.tools.createMemorySearchTool()` and `createMemoryGetTool()`, registers them with `{ names: ["memory_search", "memory_get"] }` |
| `extensions/memory-core/openclaw.plugin.json` | §8.1.1 Plugin manifest | `{ "id": "memory-core", "kind": "memory", "configSchema": {...} }` — template for zettelclaw's own manifest |
| `dist/bundled/session-memory/handler.js` | §4.3 Transcript access | **Reference implementation** for reading session transcripts. Shows: `getRecentSessionContent()` (read JSONL, parse messages), `getRecentSessionContentWithResetFallback()` (handle `.reset.*` rotation), `findPreviousSessionFile()` (locate transcript by sessionId), `event.context.previousSessionEntry` shape (`sessionId`, `sessionFile`) |
| `dist/plugin-sdk/manifest-registry-asMSwMLj.js:161` | §8.1.1 Memory slot | `resolveMemorySlotDecision()` — logic for how `plugins.slots.memory` enables/disables memory plugins. Only one `kind: "memory"` plugin active at a time |
| `dist/plugin-sdk/reply-D-26Je1S.js:15876` | §9.2, §9.3 Tool schemas | `MemorySearchSchema` (`query`, `maxResults`, `minScore`) and `MemoryGetSchema` (`path`, `from`, `lines`) — the builtin tool parameter schemas that zettelclaw extends |
| `dist/plugin-sdk/reply-D-26Je1S.js:15899` | §9.1 Builtin tool impl | `createMemorySearchTool()` and `createMemoryGetTool()` — the runtime helper functions zettelclaw wraps. Shows how they call `manager.search()` and `manager.readFile()` |
| `dist/reply-CFQ8lILc.js:69341` | §4.1 `before_reset` firing | Where `before_reset` hook fires — shows the full context: reads `sessionFile`, parses `messages[]`, provides `agentId`, `sessionKey`, `sessionId`, `workspaceDir` in context |

### Online documentation

| URL | Relevant to |
|---|---|
| https://docs.openclaw.ai/concepts/memory | §9 Memory tools — full memory system docs |
| https://docs.openclaw.ai/concepts/session | §4.1 Session lifecycle |
| https://docs.openclaw.ai/reference/session-management-compaction | §4.1 Compaction lifecycle |
| https://docs.openclaw.ai/automation/hooks | §8.2 Hook events (internal hooks — plugin hooks are a superset) |
