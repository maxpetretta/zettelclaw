# Code Review — Zettelclaw Pre-Publish

Reviewer: Claude Opus 4.6
Date: 2026-02-19
Scope: `src/`, `hooks/`, `skill/`, `templates/`, `package.json`, vault seed

---

## Critical

### 1. `templates/` and `skill/` missing from npm package

`package.json:9-14` — The `files` array is `["src", "hooks", "vault", "README.md"]`. Both `templates/` and `skill/` are excluded.

Both `init` and `migrate` resolve templates at runtime relative to the package root:

- `src/commands/init.ts:181` — `join(import.meta.dirname, "../..")` → reads `templates/post-init-event.md`
- `src/commands/migrate.ts:315-316` — same pattern → reads `templates/migrate-event.md`
- `templates/post-init-event.md:28` — instructs agent to read `skill/SKILL.md`

After `npm publish`, both commands will fail with file-not-found errors when trying to read event templates. The post-init agent notification and the entire migrate flow are broken for npm installs.

**Fix:** Add `"templates"` and `"skill"` to the `files` array.

### 2. Vault `.gitignore` uses wrong folder names

`vault/.gitignore:4-7` — The gitignore rules reference legacy folder names:

```
Attachments/*
!Attachments/.gitkeep
Agent/*
!Agent/.gitkeep
```

After init, the actual folders are `05 Attachments` and `02 Agent`. These gitignore patterns don't match the numbered names. Consequences:

- **Attachment binaries** (images, PDFs) will be tracked by git, bloating the repo
- **Agent symlinks** (pointing to `~/.openclaw/workspace/MEMORY.md`, `SOUL.md`, etc.) will be committed, potentially leaking private workspace content to a remote git repo

### 3. `configureCoreSync` crashes if `core-plugins.json` is missing

`src/lib/vault.ts:502-503` — Uses `readJsonFile` (which throws on missing file) instead of `readJsonFileOrDefault`:

```typescript
const plugins = await readJsonFile<CorePlugins>(corePluginsPath)
```

If a user deletes `core-plugins.json` from their `.obsidian/` and re-runs init, this crashes with an unhandled ENOENT. Every other config reader in the codebase uses `readJsonFileOrDefault` — this is the only one that doesn't.

---

## Warning

### 4. Hardcoded fallback model `"gpt-4o-mini"`

`hooks/zettelclaw/lib/extract.ts:303` — When no model is configured and the CLI fallback fails, the gateway completion path uses:

```typescript
const completionModel = model ?? "gpt-4o-mini"
```

If OpenAI deprecates or renames this model, extraction silently fails (returns empty summary). This should be a named constant at minimum, and ideally configurable.

### 5. Synchronous 45-second block in hook extraction

`hooks/zettelclaw/lib/extract.ts:273-295` — `runOpenClawCliSummary` uses `spawnSync` with a 45-second timeout. This blocks the event loop inside the hook handler. The function is tried *before* the async gateway fallback (`extractSessionSummary:341-343`), so every extraction attempt blocks for up to 45s before even trying the non-blocking path.

### 6. Plugin downloads are sequential

`src/lib/plugins.ts:133` — Each plugin is downloaded one at a time in a `for` loop. With 2-5 plugins + potentially a theme, this serially hits GitHub's release CDN. Each request includes redirect follow + download. Could be 3-5x faster with `Promise.all`.

### 7. `configureApp` overwrites `app.json` completely

`src/lib/vault.ts:424-430` — Writes a fresh `app.json` with only 3 keys:

```typescript
const appConfig = {
  attachmentFolderPath: folders.attachments,
  newFileLocation: "folder",
  newFileFolderPath: mode === "notes" ? folders.notes : "",
}
```

Re-running `zettelclaw init` on an existing vault strips any Obsidian settings the user has configured (font size, vim mode, line width, readable line length, etc.). Should read-then-merge like the other config functions do.

### 8. `configureMinimalTheme(enabled=false)` deletes entire `appearance.json`

`src/lib/vault.ts:603` — When minimal theme is not requested, the entire appearance config is deleted:

```typescript
await removePathIfExists(appearancePath)
```

Should either skip or only remove the `cssTheme` key, not destroy the whole file.

### 9. Agent folder deletion without safeguards

`src/lib/vault.ts:369-371` — When `configureAgentFolder(vaultPath, false)` is called:

```typescript
for (const agentFolder of AGENT_FOLDER_ALIASES) {
  await removePathIfExists(join(vaultPath, agentFolder))
}
```

This `rm -rf`'s every agent folder alias (`"02 Agent"`, `"03 Agent"`, `"Agent"`). If the user has stored non-symlinked files in an agent folder, they're silently destroyed.

### 10. Inconsistent `import.meta.dir` vs `import.meta.dirname`

Mixed usage of Bun's `import.meta.dir` and Node's `import.meta.dirname`:

- `src/lib/openclaw.ts:6` — `import.meta.dir`
- `src/lib/vault.ts:43` — `import.meta.dir`
- `src/commands/init.ts:181` — `import.meta.dirname`
- `src/commands/migrate.ts:315` — `import.meta.dirname`

Both work in Bun, but the inconsistency signals accidental drift. If Bun ever deprecates one form, half the codebase breaks.

### 11. `patchOpenClawConfig` silently swallows all errors

`src/lib/openclaw.ts:102` — The entire config patching function is wrapped in a bare `catch {}` that returns `false`. If the config is malformed JSON, the file has wrong permissions, or the write fails partway through, the user gets zero feedback. The caller in `init.ts:126` only checks the boolean to decide whether to show a "restart gateway" message — it never reports that patching failed.

### 12. `firePostInitEvent` uses unnecessary dynamic import

`src/lib/openclaw.ts:114` — `const { spawnSync } = await import("node:child_process")` dynamically imports a built-in module that could be imported statically at the top of the file. Adds unnecessary overhead and makes the dependency graph harder to analyze.

### 13. Duplicate template substitution logic

`src/lib/openclaw.ts:127` uses inline `replaceAll` chains:

```typescript
template.replaceAll("{{VAULT_PATH}}", vaultPath).replaceAll("{{PROJECT_PATH}}", projectPath)
```

While `src/commands/migrate.ts:115-121` has a proper `substituteTemplate` function doing the same thing. The openclaw version would miss any new template variables added to `post-init-event.md`.

### 14. `toTildePath` uses `process.env.HOME` instead of `os.homedir()`

`src/lib/cli.ts:14` — `const home = process.env.HOME ?? ""`. Meanwhile, `src/lib/paths.ts:1` properly imports `homedir` from `node:os`. The `HOME` env var isn't set on all platforms and can be overridden, leading to inconsistent tilde-path display vs actual path resolution.

### 15. Hardcoded vault path guesses in hook

`hooks/zettelclaw/lib/vault-path.ts:91` — Fallback vault discovery tries:

```typescript
["~/dev/obsidian", "~/obsidian", "~/Documents/obsidian"]
```

These are personal directory conventions, not universal. The default init path (`./zettelclaw`) is notably absent. If a user inits a vault at `~/projects/zettelclaw` without OpenClaw config, the hook silently finds nothing.

### 16. Note filename sanitization is incomplete

`hooks/zettelclaw/handler.ts:107-112` — `sanitizeTitleForFilename` strips `\/:*?"<>|` but misses:

- `#` and `^` — significant in Obsidian wikilinks (heading/block refs). A note titled "Config #1" creates ambiguity in `[[Config #1]]`.
- Leading `.` — creates hidden files on Unix
- Filenames exceeding 255 bytes — filesystem limit on most systems

### 17. Error in hook silently eaten

`hooks/zettelclaw/handler.ts:334-337` — The entire hook handler is wrapped in a try/catch that only calls `logWarning` (stderr). The `event.messages` array (which is the user-visible output channel) never receives an error message. If the vault is on a read-only mount or extraction crashes, the user sees nothing.

### 18. `parseModels` doesn't catch `JSON.parse` errors

`src/commands/migrate.ts:61` — `JSON.parse(json)` is called without try/catch. If `openclaw models list --json` returns non-JSON output (e.g., an error message), this throws a raw `SyntaxError` that bubbles up as an unhelpful parse error. The caller `readModelsFromOpenClaw` (line 251) doesn't catch it either.

### 19. Non-deterministic vault discovery in hook

`hooks/zettelclaw/lib/vault-path.ts:47-63` — `findVaultPath` checks immediate children of a candidate directory using `readdir`. If a directory contains multiple Obsidian vaults (e.g., `~/obsidian/personal/` and `~/obsidian/work/`), whichever one `readdir` returns first wins. Directory iteration order is filesystem-dependent and non-deterministic on some systems.

### 20. `.DS_Store` shipped in vault seed

`vault/.obsidian/.DS_Store` is present in the vault seed directory. It will be copied into every user's vault on every platform via `copyVaultSeed`. Should be in `.gitignore` at the repo root.

---

## Nitpick

### 21. `asRecord` duplicated 5 times

The same `asRecord(value: unknown): Record<string, unknown>` helper is copy-pasted in:

- `src/commands/migrate.ts:40`
- `src/lib/openclaw.ts:10`
- `hooks/zettelclaw/handler.ts:28`
- `hooks/zettelclaw/lib/extract.ts:69`
- `hooks/zettelclaw/lib/vault-path.ts:5`

The `src/` copies could share a utility. The `hooks/` copies are more justifiable (independent deployment), but even there, `handler.ts` and `lib/extract.ts` are in the same package.

### 22. Four exported functions are dead code

`src/lib/vault.ts` exports functions that are defined but never called anywhere in the codebase:

- `directoryHasEntries` (line 108)
- `copyVaultTemplatesOnly` (line 249)
- `detectNotesMode` (line 280)
- `configureTemplatesForCommunity` (line 583)

These inflate the module surface area. Either remove them or, if they're intended for external consumers, document that intent.

### 23. `"root"` notes mode is defined but unreachable

`src/commands/init.ts:89` — `const mode: NotesMode = "notes"` is hardcoded. The `"root"` variant of `NotesMode` is defined in types and handled in `remapSeedPath` and `configureApp`, but there's no way for a user to select it. Dead code path.

### 24. Redundant triple `.trim()`

`hooks/zettelclaw/handler.ts:163`:

```typescript
const body = (note.body.trim().length > 0 ? note.body.trim() : note.summary.trim()).trim()
```

The outer `.trim()` is redundant — both branches already return trimmed strings.

### 25. Dead comment about removed function

`hooks/zettelclaw/handler.ts:68`:

```typescript
// formatTime removed — unused after journal refactor
```

Leftover comment about deleted code. Just noise.

### 26. `SyncMethod` type assertion on select result

`src/commands/init.ts:72`:

```typescript
) as SyncMethod
```

The `select()` return type can't be narrowed by the generic, requiring a cast. Safe in practice (values are hardcoded), but a runtime check would be more defensive.

### 27. `FOLDERS_WITHOUT_AGENT` defines an `agent` path

`src/lib/vault.ts:57-64` — The "without agent" folder layout still defines `agent: "02 Agent"`. This value is never meaningfully used in the no-agent path, since `configureAgentFolder(false)` uses `AGENT_FOLDER_ALIASES` directly. Confusing to readers.

### 28. Folder candidate lists maintained in multiple places

Notes/journal folder detection candidates appear independently in:

- `src/commands/migrate.ts:11-12` — `NOTES_FOLDER_CANDIDATES`, `JOURNAL_FOLDER_CANDIDATES`
- `hooks/zettelclaw/handler.ts:86-87` — inline `["01 Notes", "Notes"]`
- `hooks/zettelclaw/handler.ts:97` — inline `["03 Journal", "02 Journal", "Journal", "Daily"]`
- `src/lib/vault.ts:76-83` — `JOURNAL_FOLDER_ALIASES`

Adding a new folder naming convention requires updating 3+ files. Easy to miss one.

### 29. `chooseBackupPath` has no upper bound

`src/commands/migrate.ts:237-249` — The `while (true)` loop checking `memory.bak`, `memory.bak.1`, `memory.bak.2`, etc. has no iteration limit. Extremely unlikely to be a problem in practice, but a `maxAttempts` guard would be defensive.

### 30. Unused return value from `createAgentSymlinks`

`src/commands/init.ts:121` — The `CopyResult` returned by `createAgentSymlinks` is discarded. The user never learns which symlinks were created vs skipped. Could be included in the summary output.

### 31. `contentToString` / `contentToText` duplicated between hook files

`hooks/zettelclaw/lib/extract.ts:77-100` (`contentToString`) and `hooks/zettelclaw/lib/session.ts:35-73` (`contentToText`) are nearly identical recursive content extractors with slightly different key traversal. Could be a single shared function.

### 32. Biome `defaultBranch` is `"master"` but main branch is `main`

`biome.jsonc:98` — `"defaultBranch": "master"`. The git status shows the main branch is `main` (used for PRs). This mismatch could affect Biome's VCS-aware features (changed file detection).
