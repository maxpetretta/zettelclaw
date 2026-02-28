---
name: zettelclaw
description: "Use when accessing memory, recording information, or searching prior context."
read_when:
  - You need to find something from a previous session
  - You want to record a decision, fact, task, or question
  - You're asked about what you remember or know
---

# Zettelclaw Memory Guide

## Entry Types
- `task`: A concrete action item. Must include status: `open` or `done`.
- `fact`: User-specific information learned from context.
- `decision`: A choice made; include why in `detail` when useful.
- `question`: An unresolved open loop.
- `handoff`: Session boundary state; one per session.

## Retrieval Flow
1. Last handoff is auto-injected into context.
2. `MEMORY.md` generated briefing is auto-loaded.
3. Use `memory_search` for broader lookups.
4. Use `memory_get` for exact entry/file/session retrieval.

## `memory_search` Usage
- Semantic query:
  - `memory_search({"query":"webhook retries"})`
- Structured filters:
  - `memory_search({"type":"decision","subject":"auth-migration"})`
  - `memory_search({"type":"task","status":"open"})`
- Include superseded entries only when needed:
  - `{"includeReplaced":true}`

## `memory_get` Usage
- By entry ID (12-char ID):
  - `memory_get({"path":"abc123def456"})`
- By session transcript:
  - `memory_get({"path":"session:abc123def456"})`
- By memory file path:
  - `memory_get({"path":"MEMORY.md"})`

## Corrections and Replacements
- If memory is wrong/outdated, state the correction clearly.
- Extraction writes a new entry that points to the older one via `replaces`.
- Log is append-only; old entries are not edited in place.

## Hard Filter
Do not treat generic or universal knowledge as memory.
Only retain information specific to this user, their projects, decisions, tasks, and unresolved questions.
