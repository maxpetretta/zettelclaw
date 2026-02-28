# Memory Structure Research Synthesis (2026-02-24)

Status: Draft
Author: Codex session synthesis
Scope: Agent memory structure principles for Zettelclaw and Reclaw

## 1. Research Inputs

Reviewed on 2026-02-24/25/26:

1. X Article (Berkay Ozcan): https://x.com/ozcberkay/status/2020220556843332072
2. YouTube video: https://www.youtube.com/watch?v=6MBq1paspVU
3. X Article (Ramya Chinnadurai): https://x.com/code_rams/status/2025630269559185648
4. X Article (Pedro / ClawVault): https://x.com/sillydarket/status/2022394007448429004
5. X Article (Nat Eliason): https://x.com/nateliason/status/2017636775347331276
6. Ars Contexta repo: https://github.com/agenticnotetaking/arscontexta
7. ClawVault repo: https://github.com/Versatly/clawvault
8. X Article (James Bedford): https://x.com/jameesy/status/2026628809424781787

Notes:
- X article bodies were retrieved via the public API mirror endpoint `https://api.fxtwitter.com/status/<id>` because direct unauthenticated scraping of `x.com` was blocked.
- YouTube was summarized via CLI command `summarize` (transcript-based extraction).
- Bedford article is a native X long-form article; full text extracted via fxtwitter API + web search.

## 2. Shared Principles Across Methods

Across all sources, the strongest recurring principles were:

1. File-native memory wins for practical agent workflows.
   - Markdown + folders + predictable metadata are easier for models to use reliably than bespoke memory APIs.
2. Layered memory is required.
   - Separate boot context, working timeline/operations, and durable knowledge.
3. Retrieval quality depends on structure, not only search model quality.
   - Better typing, linking, and metadata often improve outcomes more than switching embedding backends.
4. Continuity requires explicit write-back discipline.
   - If decisions and handoffs are not written before compaction/session end, they are effectively lost.
5. Non-destructive memory evolution works better than deletion.
   - Supersede/decay/archive patterns preserve auditability while reducing active-context noise.
6. Agent workspace and human knowledge should have clear boundaries.
   - Agent working artifacts (drafts, intermediates) should not pollute the human's knowledge graph. (Bedford, Ars Contexta)
7. Intent orientation matters as much as state orientation.
   - The agent needs to know not just *what's happening* (state) but *why it matters* (intent/goals/priorities). Human-authored intent gives the agent judgment, not just context. (Bedford's Polaris, Vin's vault-as-source-of-truth)

## 3. Notable Concepts by Source

## 3.1 Berkay article

1. Minimal architecture thesis:
   - "Local files + conventions + agent that can read them" is often enough for personal memory.
2. Useful split:
   - `MEMORY.md` as immediate summary, vault as full source of truth.
3. Practical insight:
   - The bottleneck is often information architecture, not retrieval infrastructure.

## 3.2 Ramya article

1. Compaction-safe memory:
   - Flush important context to disk before compaction.
2. Retrieval discipline:
   - "Information exists" and "agent uses it" are separate concerns.
3. Operational reliability:
   - Keep boot instructions in actually auto-loaded files.
4. Token hygiene:
   - Remove dead prompt/skill weight to increase effective recall.

## 3.3 Pedro / ClawVault article

1. Typed memory taxonomy:
   - Decision, preference, relationship, commitment, lesson.
2. Priority-aware recall:
   - Critical/Notable/Background style budgeted retrieval.
3. Index-first navigation:
   - Single index/table-of-contents pass before deep search.
4. Interoperability:
   - One markdown format serving human and agent consumers.

## 3.4 Nat Eliason article

1. Three-layer model:
   - Knowledge graph, daily notes, tacit knowledge.
2. Atomic fact schema:
   - Stable IDs, category, timestamps, source, supersession, related entities.
3. Decay model:
   - Hot/Warm/Cold visibility without deleting base facts.
4. Scheduled extraction:
   - Heartbeat/periodic synthesis from daily timeline into durable structures.

## 3.5 Ars Contexta repo

1. Three-space architecture:
   - `self/`, `notes/`, `ops/` separation to prevent graph pollution.
2. Promotion model:
   - Operational observations graduate into durable notes when evidence accumulates.
3. Anti-drift posture:
   - Include explicit coherence checks and reseed conditions.

## 3.6 ClawVault repo

1. Session lifecycle primitives:
   - `wake`, `checkpoint`, `sleep`, and handoff capture.
2. Context profiles:
   - Retrieval profile by task mode (incident/planning/handoff/etc.).
3. MEMORY.md boundary:
   - Executive summary vs authoritative full vault pattern.

## 3.7 YouTube (Obsidian + Claude Code workflow)

1. Vault-as-source-of-truth workflow:
   - Manage the knowledge base, not just the agent prompt.
2. Commandized reflection:
   - Explicit commands for planning, review, contradiction checks, traceability.
3. Delegation effect:
   - Better historical structure improves practical agent delegation quality.

## 3.8 James Bedford article

1. Hard separation of agent workspace from human vault:
   - Dedicated Claude folder outside the Obsidian vault for agent working files (repos, meeting notes).
   - Agent output stays out of the knowledge graph. Human-curated knowledge remains distinct from agent artifacts.
2. Polaris folder (intent-first orientation):
   - Dedicated folder for goals, aspirations, guiding principles — the human's "north star."
   - Includes a "Life Razor" (single-sentence mission statement) and "Top of Mind" document for current focus.
   - This is what the agent reads first to understand *why* things matter, not just *what's* happening.
3. Commonplace book pattern:
   - Individual thoughts/observations as atomic notes, separate from daily logs.
   - Named after the historical commonplace book tradition — closer to "facts with context" than Zettelkasten "claims with arguments."
4. Tags as primary navigation:
   - Nested tags described as "criminally underutilized" in Obsidian.
   - Tags work well for both human browsing and agent querying (ripgrep-friendly).
5. Idea Reports:
   - Prompt pattern where the agent analyzes the vault and generates focus-time recommendations.
   - Surfaces connections the human missed, threads not yet explored.
   - Similar to Vin's "emerge" command but framed as a periodic report rather than an on-demand tool.

## 4. Comparison for Zettelclaw Fit

Best direct fit for Zettelclaw:

1. Keep markdown-first typed notes and journal flow (already aligned).
2. Add deterministic read-first views before broad search.
3. Add session handover contract inside journal sessions.
4. Add optional journal priority tags to support budget-aware retrieval.
5. Add non-destructive decay/archive views for active corpus focus.
6. Define MEMORY.md as two halves: human-authored intent (goals, priorities, current focus — Bedford's Polaris) + agent-generated state briefing (active projects, recent decisions, pending items).
7. Relax evergreen note format toward Bedford's "commonplace" model — facts with context rather than claims with arguments.

Lower-fit or defer:

1. Full PARA directory migration (high churn, low immediate ROI).
2. Mandatory cloud/vector-first architecture (violates local-first goals).
3. Hard separation of agent-authored vs human-authored notes (Zettelclaw's co-authorship model is intentional, but optional `author` frontmatter field could support filtering).

## 5. Recommendations for Zettelclaw

## 5.1 Near-term (high ROI)

1. Add generated `06 Views/` entry points:
   - `Now.md`, `Recent Decisions.md`, `Open Questions.md`, `Archive Candidates.md`.
2. Enforce active-first retrieval order:
   - `Now.md` -> relevant project/research note -> recent journals -> deep search.
3. Add handover fields in journal `## Sessions` lines:
   - `working_on`, `decided`, `pending`, `next`.
4. Add optional journal priority prefixes:
   - `[critical]`, `[notable]`, `[background]`.
5. Keep `01 Notes` as authority and views as derived artifacts.

## 5.2 Mid-term

1. Add verify warnings (initially non-failing):
   - stale views, missing handovers, low reciprocity ratios.
2. Add archive candidate generation with manual approval.
3. Add lightweight heat ranking for retrieval (hot/warm/cold) without deleting notes.

## 6. Recommendations for Reclaw Export

Reclaw should emit export artifacts that are memory-ready, not just transcript-ready.

## 6.1 Export schema principles

1. Preserve original chronology:
   - message timestamps, session boundaries, timezone, source IDs.
2. Emit typed durable units:
   - decision, preference, relationship, commitment, lesson, status, milestone.
3. Attach provenance to every durable fact:
   - source platform, conversation id, message span/timestamp.
4. Support supersession:
   - do not overwrite old facts; mark `superseded_by`.
5. Emit open loops:
   - pending, blockers, next actions, unresolved questions, handover notes.
6. Include priority and confidence:
   - to improve context packing and retrieval ordering.
7. Apply hard filter during export:
   - keep user-specific memory signals; exclude generic docs/noise.

## 6.2 Why this helps agent memory

1. Better retrieval precision under token constraints.
2. Stronger continuity across model switches and long sessions.
3. Better trust/auditability due to explicit provenance.
4. Lower duplication and contradiction drift over time.

## 7. Suggested Validation Benchmarks

After implementing Zettelclaw/Reclaw improvements, track:

1. Retrieval preflight cost:
   - files read before correct answer for common tasks.
2. Handover coverage:
   - percentage of meaningful days with complete handover fields.
3. Reciprocity quality:
   - recent journal->note backlink completeness.
4. Contradiction handling:
   - percentage of changed decisions correctly superseded, not overwritten.
5. Export usefulness:
   - durable facts accepted/promoted vs rejected as noise.

## 8. Related Local Artifacts

Session artifact paths used during this synthesis:

1. `/tmp/fx-2020220556843332072.json`
2. `/tmp/fx-2025630269559185648.json`
3. `/tmp/fx-2022394007448429004.json`
4. `/tmp/fx-2017636775347331276.json`
5. `/tmp/arscontexta-1771992374/`
6. `/tmp/clawvault-1771992374/`

This document is the persistent summary intended for repo history; `/tmp` artifacts are ephemeral.

