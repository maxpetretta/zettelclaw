---
name: zettelclaw
description: "Dispatch vault-maintenance tasks from session resets"
homepage: https://zettelclaw.com
metadata:
  openclaw:
    emoji: "🦞"
    events: ["command:new", "command:reset"]
    requires:
      config: ["workspace.dir"]
---

# Zettelclaw Hook

Dispatches an agent task on `/new` or `/reset` so the agent can navigate the vault and update/create notes directly. Also performs idempotent transcript sweeps to backfill missed sessions.

## Config

`hooks.internal.entries.zettelclaw` supports:

- `enabled` (boolean): enable/disable the hook
- `messages` (number): recent user/assistant messages to consider (default: `20`)
- `vaultPath` (string): explicit vault path override
- `model` (string): preferred model hint for spawned subagents
- `expectFinal` (boolean): wait for the system event to finish before returning (default: `false`)
- `sweepEnabled` (boolean): enable/disable transcript sweeps (default: `true`)
- `sweepEveryMinutes` (number): minimum minutes between sweeps (default: `30`)
- `sweepMessages` (number): max turns per swept transcript extraction (default: `120`)
- `sweepMaxFiles` (number): max transcripts to inspect per sweep run (default: `40`)
- `sweepStaleMinutes` (number): minimum age for active `.jsonl` transcripts (default: `180`)
