---
name: zettelclaw
description: "Extract atomic vault notes from session conversations on /new"
homepage: https://zettelclaw.com
metadata:
  openclaw:
    emoji: "🦞"
    events: ["command:new"]
    requires:
      config: ["workspace.dir"]
---

# Zettelclaw Hook

Extracts atomic, reusable notes from recent session conversation context when `/new` is run.

## Config

`hooks.internal.entries.zettelclaw` supports:

- `enabled` (boolean): enable/disable the hook
- `messages` (number): recent user/assistant messages to consider (default: `20`)
- `vaultPath` (string): explicit vault path override
- `model` (string): model override for extraction
