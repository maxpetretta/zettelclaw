# Zettelclaw Pre-Publish Code Review

Scope reviewed in full: `src/`, `hooks/`, `skill/`, `templates/`.

## Critical

1. **Cross-platform path handling is broken in vault seed remapping (Windows path separators).**
   - Evidence: `src/lib/vault.ts:120`, `src/lib/vault.ts:133`, `src/lib/vault.ts:134`, `src/lib/vault.ts:149`, `src/lib/vault.ts:153`, `src/lib/vault.ts:157`, `src/lib/vault.ts:398`.
   - Why this is critical: `walkFiles` builds relative paths with `join(...)` (platform separator), but remapping logic assumes `/`. On Windows, checks like `startsWith("03 Journal/")` fail, so files can be copied into wrong locations or not remapped when `includeAgent=false`.

2. **`init` can crash on existing/irregular vaults due to hard dependency on `.obsidian/core-plugins.json`.**
   - Evidence: `src/lib/vault.ts:501`, `src/lib/vault.ts:503`, `src/lib/vault.ts:380`, `src/commands/init.ts:103`.
   - Why this is critical: `configureCoreSync` calls `readJsonFile` without fallback; missing or malformed `core-plugins.json` throws and aborts setup mid-run.

3. **Symlink creation can hard-fail setup on platforms/environments without symlink privileges.**
   - Evidence: `src/lib/vault.ts:335`, `src/lib/vault.ts:344`, `src/commands/init.ts:120`, `src/commands/init.ts:121`.
   - Why this is critical: common Windows environments (without Developer Mode/admin) throw `EPERM` on file symlink creation; this exception bubbles and can kill `zettelclaw init` after partial writes.

## Warning

1. **Hook vault-path resolution likely mismatches where init patches OpenClaw config.**
   - Evidence: `hooks/zettelclaw/lib/vault-path.ts:76`, `hooks/zettelclaw/lib/vault-path.ts:77`, `src/lib/openclaw.ts:54`, `src/lib/openclaw.ts:58`, `src/lib/openclaw.ts:61`.
   - Impact: init writes `agents.defaults.memorySearch.extraPaths`, but hook resolver reads `cfg.memorySearch.extraPaths`. If runtime config is not flattened, hook can miss the configured vault.

2. **Auto-detecting vault by scanning child directories is nondeterministic.**
   - Evidence: `hooks/zettelclaw/lib/vault-path.ts:47`, `hooks/zettelclaw/lib/vault-path.ts:49`, `hooks/zettelclaw/lib/vault-path.ts:55`.
   - Impact: first matching child with `.obsidian` is returned in filesystem order (unsorted), so users with multiple vaults in a parent folder can get inconsistent behavior.

3. **Message count is unbounded, and session reading is full-file, enabling expensive hook runs.**
   - Evidence: `hooks/zettelclaw/handler.ts:70`, `hooks/zettelclaw/handler.ts:77`, `hooks/zettelclaw/lib/session.ts:113`, `hooks/zettelclaw/lib/session.ts:114`, `hooks/zettelclaw/lib/session.ts:121`.
   - Impact: large configured `messages` values can force reading/parsing very large JSONL files and sending oversized transcripts to extraction.

4. **Network calls lack timeout/abort controls in key paths.**
   - Evidence: `src/lib/plugins.ts:58`, `hooks/zettelclaw/lib/extract.ts:306`.
   - Impact: `init` plugin downloads and hook extraction fallback can hang indefinitely on bad network conditions.

5. **Fallback model is hardcoded to `gpt-4o-mini`.**
   - Evidence: `hooks/zettelclaw/lib/extract.ts:303`.
   - Impact: on gateways without that model alias, fallback extraction always fails.

6. **Migration folder detection omits some aliases used elsewhere in the codebase.**
   - Evidence: `src/commands/migrate.ts:12`, `src/commands/migrate.ts:200`, `src/lib/vault.ts:79`, `src/lib/vault.ts:80`.
   - Impact: vaults using `02 Daily`/`03 Daily` patterns can fail migration layout detection despite being functionally compatible.

7. **Migration event payload can exceed command-line argument limits for large migrations.**
   - Evidence: `src/commands/migrate.ts:326`, `src/commands/migrate.ts:339`, `src/commands/migrate.ts:412`, `src/commands/migrate.ts:413`.
   - Impact: serializing full `dailyFiles`/`otherFiles` arrays into `--message` risks `E2BIG`/spawn failure on large datasets.

8. **Migration progress instruction likely points at the wrong session.**
   - Evidence: `src/commands/migrate.ts:335`, `src/commands/migrate.ts:337`, `src/commands/migrate.ts:422`.
   - Impact: cron job is scheduled into `--session isolated`, but user is told to watch `--session zettelclaw-migrate` (the cron name), which may not contain the run output.

9. **Plugin download can leave partially-written/broken plugin directories.**
   - Evidence: `src/lib/plugins.ts:72`, `src/lib/plugins.ts:79`, `src/lib/plugins.ts:81`, `src/lib/plugins.ts:87`.
   - Impact: failed required assets still leave directories/files behind, which can produce confusing plugin behavior in Obsidian.

10. **Important OpenClaw setup failures are swallowed with little diagnostics.**
   - Evidence: `src/lib/openclaw.ts:41`, `src/lib/openclaw.ts:42`, `src/lib/openclaw.ts:102`, `src/lib/openclaw.ts:103`.
   - Impact: users get `failed`/`false` without actionable reason (permissions, malformed JSON, missing files), making setup troubleshooting hard.

11. **`init` silently disables OpenClaw integration when workspace path is missing/not a directory.**
   - Evidence: `src/commands/init.ts:90`, `src/commands/init.ts:91`, `src/commands/init.ts:92`, `src/commands/init.ts:120`, `src/commands/init.ts:124`.
   - Impact: user can pass a bad `--workspace` and still see successful setup without explicit warning that hooks/symlinks/config patch were skipped.

12. **Existing Obsidian settings are overwritten instead of merged in key config files.**
   - Evidence: `src/lib/vault.ts:424`, `src/lib/vault.ts:430`, `src/lib/vault.ts:608`, `src/lib/vault.ts:610`.
   - Impact: `app.json` and `appearance.json` lose unrelated user settings, which is risky for pre-existing vaults.

13. **When extraction fails completely, hook still writes/updates journal and reports success-like status.**
   - Evidence: `hooks/zettelclaw/lib/extract.ts:351`, `hooks/zettelclaw/lib/extract.ts:352`, `hooks/zettelclaw/handler.ts:321`, `hooks/zettelclaw/handler.ts:332`.
   - Impact: users can get empty/low-value journal updates with no clear indication extraction failed.

14. **Model lookup is exact-match only with minimal error context.**
   - Evidence: `src/commands/migrate.ts:112`, `src/commands/migrate.ts:277`.
   - Impact: case/alias mismatches fail with `Model not found` and no helpful list/suggestions.

## Nitpick

1. **Stale inline comment left in production code.**
   - Evidence: `hooks/zettelclaw/handler.ts:68`.
   - Impact: minor quality signal issue (`formatTime removed` comment without related code nearby).

2. **Logging style is inconsistent across CLI surfaces.**
   - Evidence: `src/commands/migrate.ts:322`, `src/lib/openclaw.ts:122`, `src/lib/openclaw.ts:143`.
   - Impact: mixed `console.warn` and `@clack/prompts` logging reduces consistency of UX/output formatting.

3. **Type style is noisy/redundant in several option fields.**
   - Evidence: `src/index.ts:9`, `src/index.ts:12`, `src/index.ts:14`, `src/index.ts:15`.
   - Impact: `?` plus `| undefined` is redundant under current TS settings; not wrong, but adds clutter.

4. **Skill guidance examples use `grep` broadly despite repo convention favoring `rg`.**
   - Evidence: `skill/SKILL.md:43`, `skill/SKILL.md:46`, `skill/SKILL.md:49`, `skill/SKILL.md:52`.
   - Impact: minor inconsistency with the project’s own tooling preference and performance guidance.
