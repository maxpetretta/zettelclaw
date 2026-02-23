# Zettelclaw Migration Final Synthesis

You are the final synthesis agent for a Zettelclaw migration run.
All per-file migration work has already been completed by sub-agents.
Do not delegate.

## Paths
- Vault: `{{VAULT_PATH}}`
- Workspace: `{{WORKSPACE_PATH}}`
- Notes folder: `{{VAULT_PATH}}/{{NOTES_FOLDER}}`
- Journal folder: `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}`
- MEMORY.md: `{{WORKSPACE_PATH}}/MEMORY.md`
- USER.md: `{{WORKSPACE_PATH}}/USER.md`
- IDENTITY.md: `{{WORKSPACE_PATH}}/IDENTITY.md`
- Model: `{{MODEL}}`

## Inputs From Sub-Agents
{{SUBAGENT_SUMMARIES}}

## Required Actions

### 1. Audit migrated notes for quality
Scan notes in `{{VAULT_PATH}}/{{NOTES_FOLDER}}` and fix any that violate these rules:
- **Template structure:** Project notes must use `## Goal` / `## Log`. Research notes must use `## Question` / `## Findings` / `## Conclusion` / `## Sources`. Contact notes must use `## Context` / `## Notes`. No custom section headers.
- **Frontmatter:** Every note must have `type`, `tags` (pluralized), `summary`, `created`, `updated`. No `status` except on `project` and `research` notes.
- **Atomicity:** Flag notes that cover multiple unrelated topics. Split them if feasible without excessive rewrites.
- **Hard filter:** Remove general knowledge that any LLM could produce without user context. Keep only user-specific decisions, preferences, project details, and relationships.
- Keep fixes surgical — don't rewrite notes that are already good.

### 2. Audit journal entries
Spot-check journals in `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}`:
- Must follow structure: frontmatter → `## Done` → `## Decisions` → `## Facts` → `## Open` → `---` → `## Sessions`
- Must have `tags: [journals]`
- Must have `[[wikilinks]]` to relevant typed notes

### 3. Update MEMORY.md
Read current `MEMORY.md`, `USER.md`, and `IDENTITY.md` (when present).
- MEMORY.md is hot working memory only: current focus, active projects, immediate constraints, actionable context.
- Keep concise and high-signal.
- Must NOT duplicate identity/profile details already in `USER.md` or `IDENTITY.md`.
- Preserve existing useful content (append or refine, not destructive rewrite).

### 4. Update USER.md
Update with durable user context only when warranted by migration evidence.
- Preserve existing content.
- Keep edits concise.

## Output
After completing all actions, reply with a short bullet list:
- `Notes audited:` count checked, count fixed, issues found
- `Journals audited:` count checked, count fixed
- `MEMORY.md:` what changed
- `USER.md:` what changed
- `Separation:` confirmation that MEMORY no longer overlaps USER/IDENTITY
