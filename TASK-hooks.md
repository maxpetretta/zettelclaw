# Task: Implement Zettelclaw OpenClaw Hook

## Context

Zettelclaw replaces OpenClaw's default memory system. Instead of raw transcript dumps to `memory/YYYY-MM-DD-slug.md`, session resets extract atomic vault notes with proper frontmatter. The vault becomes the single source of truth.

Read the existing codebase first — `src/` has the CLI, `vault/` has the template. This task adds a new **OpenClaw hook** that ships with the package.

## What to Build

### 1. Hook: `hooks/zettelclaw/` (OpenClaw hook directory)

Create a hook that replaces the bundled `session-memory` hook.

**Directory structure:**
```
hooks/zettelclaw/
├── HOOK.md          # Hook metadata (YAML frontmatter + docs)
└── handler.ts       # HookHandler implementation
```

**HOOK.md frontmatter:**
```yaml
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
```

**Handler behavior (`handler.ts`):**

The handler fires on `command:new` and does the following:

1. **Read recent session content** — Same approach as the bundled session-memory hook: read the session JSONL file, extract the last N user/assistant messages (default: 20, configurable via hook config `messages`). Handle reset file fallbacks (`.jsonl.reset.*` siblings).

2. **Resolve vault path** — Read from hook config (`vaultPath`) or fall back to checking the OpenClaw config's `memorySearch.extraPaths` for a path containing a `vault` or `.obsidian` directory. If no vault found, log a warning and skip.

3. **Resolve notes directory** — Check if `Notes/` or `01 Notes/` exists in the vault. Use whichever is found (support both numbered and unnumbered folder names).

4. **Call LLM for extraction** — Send the conversation content to the configured LLM with this system prompt:

```
You are a knowledge extraction agent. Given a conversation transcript, extract atomic ideas worth preserving as permanent notes.

Rules:
- Each note captures ONE idea (atomic). The title IS the idea.
- Title format: Title Case, opinionated/descriptive (e.g., "React Virtual DOM Trades Memory For Speed")
- Skip mundane chatter, greetings, troubleshooting steps that aren't reusable insights
- Skip anything that's just "we did X" without a reusable takeaway
- If nothing is worth extracting, return an empty array
- Include wikilinks to related concepts using [[Double Brackets]]
- Add relevant tags (always pluralized: "projects" not "project")

Respond with JSON only — an array of objects:
[
  {
    "title": "Note Title In Title Case",
    "type": "note",
    "tags": ["tag1", "tag2"],
    "summary": "One-line summary of the idea",
    "body": "The full note content with [[wikilinks]] to related concepts.\n\nCan be multiple paragraphs.",
    "source": "conversation"
  }
]

If nothing worth extracting, respond with: []
```

5. **Write vault notes** — For each extracted note:
   - Filename: `{Title}.md` in the notes directory (Title Case, no special chars)
   - Skip if a file with that name already exists (don't overwrite)
   - Write with full YAML frontmatter:
     ```yaml
     ---
     type: note
     tags: [extracted-tags]
     summary: "extracted summary"
     source: "[[YYYY-MM-DD]]"
     created: YYYY-MM-DD
     updated: YYYY-MM-DD
     ---
     ```
   - Body follows the frontmatter

6. **Write/append to journal** — Append a brief extraction log to `Journal/YYYY-MM-DD.md` or `03 Journal/YYYY-MM-DD.md` (whichever exists). Create it if it doesn't exist (use the journal template frontmatter). Log format:
   ```markdown
   ## Session Reset (HH:MM)
   Extracted N notes: [[Note Title 1]], [[Note Title 2]]
   ```

7. **Send confirmation** — Push a message to `event.messages`: `"🦞 Extracted N notes to vault: Note Title 1, Note Title 2"` (or `"🦞 No extractable insights from this session"` if empty).

**Hook config options** (via `hooks.internal.entries.zettelclaw`):
- `messages` (number, default 20): How many recent messages to read
- `vaultPath` (string, optional): Explicit vault path override
- `model` (string, optional): Model override for extraction LLM call

### 2. CLI Integration: `zettelclaw init --openclaw` changes

Update the `--openclaw` flow in `src/commands/init.ts` to also:

a. **Install the hook** — Copy `hooks/zettelclaw/` to `~/.openclaw/hooks/zettelclaw/` (the managed hooks directory). Skip if already exists.

b. **Enable the hook in config** — When patching `openclaw.json`, also add:
```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "zettelclaw": { "enabled": true },
        "session-memory": { "enabled": false }
      }
    }
  }
}
```

c. **Print instructions** — Tell the user to restart the gateway for hooks to take effect.

### 3. Update `src/lib/openclaw.ts`

The existing `patchOpenClawConfig` function patches `memorySearch.extraPaths`. Extend it to also:
- Add the hooks config (enable zettelclaw, disable session-memory)
- Deep merge, don't overwrite existing hook entries

### 4. Hook Type Compatibility

The handler needs to be compatible with OpenClaw's `HookHandler` type. Since we can't import from OpenClaw internals in a distributed package, define the handler with this signature:

```typescript
interface HookEvent {
  type: string;
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: {
    cfg?: any;
    sessionEntry?: any;
    previousSessionEntry?: any;
    sessionId?: string;
    sessionFile?: string;
    commandSource?: string;
    senderId?: string;
    workspaceDir?: string;
  };
}

type HookHandler = (event: HookEvent) => Promise<void>;
```

For the LLM call, use a simple `fetch` to the OpenClaw gateway's local API (`http://localhost:3456/v1/chat/completions` or read the port from config). Alternatively, shell out to `openclaw message` or use a simpler approach — just write a placeholder that logs what it would do, and we'll wire up the LLM call after testing the structure.

**Actually, the simplest approach for the LLM call:** Use the same pattern as the bundled session-memory hook. Look at how `generateSlugViaLLM` works in the bundled hook — it imports from OpenClaw internals. Since our hook will be installed in `~/.openclaw/hooks/` and loaded by the gateway in-process, we CAN import from the OpenClaw module path. But the import paths are hashed bundle names (like `../../llm-slug-generator.js`), which is fragile.

**Best approach:** Shell out to `openclaw` CLI for the LLM call:
```bash
echo "<conversation>" | openclaw llm-task --model <model> --system "<extraction prompt>" --json
```

If `openclaw llm-task` doesn't exist, fall back to a direct `fetch` to `http://localhost:${port}/v1/chat/completions` using the OpenAI-compatible API. Read port from `~/.openclaw/gateway.json` or default to 3456.

### 5. Vault Path Resolution Helper

Create `hooks/zettelclaw/lib/vault-path.ts` (or inline) with logic to find the vault:

```typescript
async function resolveVaultPath(cfg: any, hookConfig: any): Promise<string | null> {
  // 1. Explicit hook config
  if (hookConfig?.vaultPath) return hookConfig.vaultPath;
  
  // 2. Check memorySearch.extraPaths for a vault
  const extraPaths = cfg?.memorySearch?.extraPaths || [];
  for (const p of extraPaths) {
    const resolved = p.replace(/^~/, os.homedir());
    if (await hasObsidianVault(resolved)) return resolved;
  }
  
  // 3. Common locations
  for (const candidate of ['~/dev/obsidian', '~/obsidian', '~/Documents/obsidian']) {
    const resolved = candidate.replace(/^~/, os.homedir());
    if (await hasObsidianVault(resolved)) return resolved;
  }
  
  return null;
}

async function hasObsidianVault(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.obsidian'));
    return true;
  } catch { return false; }
}
```

## File Structure (final)

```
~/dev/zettelclaw/
├── hooks/
│   └── zettelclaw/
│       ├── HOOK.md
│       ├── handler.ts
│       └── lib/
│           ├── extract.ts      # LLM extraction logic
│           ├── vault-path.ts   # Vault resolution
│           └── session.ts      # Session content reading
├── src/
│   ├── commands/
│   │   ├── init.ts             # Updated with hook installation
│   │   └── upgrade.ts
│   ├── lib/
│   │   ├── openclaw.ts         # Updated with hooks config patching
│   │   ├── paths.ts
│   │   ├── plugins.ts
│   │   └── vault.ts
│   └── index.ts
├── vault/                      # Vault template (existing)
├── package.json                # Add hooks/ to "files" array
└── README.md
```

## Constraints

- Do NOT modify files outside `~/dev/zettelclaw/`
- Do NOT actually call the OpenClaw gateway or LLM during development — the extraction LLM call should be implemented but we can't test it without a running gateway
- The hook handler should gracefully handle missing vault, missing config, LLM failures — always log and return, never throw
- Use TypeScript throughout
- Commit when done with a meaningful message

## Testing Notes

After implementation, we'll test by:
1. Copying `hooks/zettelclaw/` to `~/.openclaw/hooks/zettelclaw/`
2. Enabling it via `openclaw hooks enable zettelclaw`
3. Disabling `session-memory` via `openclaw hooks disable session-memory`  
4. Restarting the gateway
5. Having a conversation, then sending `/new`
6. Checking if vault notes were created

## Reference

- OpenClaw hooks docs: See `HOOK.md` format and `HookHandler` type in the OpenClaw docs
- Bundled session-memory handler: Uses `generateSlugViaLLM` for filename generation, reads session JSONL, writes to workspace/memory/
- Our hook replaces that flow entirely — extracts to vault notes instead of raw transcripts
