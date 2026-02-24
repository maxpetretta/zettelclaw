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
- **Titles must be claims, not topics.** "SQLite Outperforms Postgres For Single-Server Workloads" is good. "Tech Stack" is bad. Rename notes whose titles are topics. Exception: project notes (`<Name> Project`) and contact notes are containers.
- **Notes must be short.** Evergreen: 2-5 sentences. Research Findings: 2-3 short paragraphs. Trim wiki-style articles, dependency lists, and reference docs.
- **Template structure:** Project notes: `## Goal` / `## Log` only. Research notes: `## Question` / `## Findings` / `## Conclusion` / `## Sources`. Contact notes: `## Context` / `## Notes`. No custom section headers.
- **Frontmatter:** Every note must have `type`, `tags` (pluralized), `created`, `updated`. Only `project` and `contact` need `summary`. No `status`, no `source`, no `aliases`.
- **Hard filter:** Remove general knowledge, dependency lists, version inventories. Keep only user-specific decisions, preferences, and relationships.
- Keep fixes surgical — don't rewrite notes that are already good.

### 2. Audit journal entries
Spot-check journals in `{{VAULT_PATH}}/{{JOURNAL_FOLDER}}`:
- Must follow structure: frontmatter → `## Log` → `## Open` → `---` → `## Sessions`
- Must have `tags: [journals]`
- Must have `[[wikilinks]]` to relevant typed notes

### 3. Update MEMORY.md
Read current `MEMORY.md`, `USER.md`, and `IDENTITY.md` (when present).
- MEMORY.md is hot working memory only: current focus, active projects, actionable context.
- Keep concise. Must NOT duplicate `USER.md` or `IDENTITY.md`.
- Preserve existing useful content.

### 4. Update USER.md
Update with durable user context only when warranted by migration evidence.
- Preserve existing content. Keep edits concise.

## Output
After completing all actions, reply with a short bullet list:
- `Notes audited:` count checked, count fixed, issues found
- `Journals audited:` count checked, count fixed
- `MEMORY.md:` what changed
- `USER.md:` what changed
