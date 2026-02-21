[Zettelclaw Setup Complete] Your memory system has been upgraded.

A Zettelclaw vault has been initialized at `{{VAULT_PATH}}`. The vault is now your primary knowledge store — it replaces workspace daily notes as your memory system. A hook has been installed that appends raw session capture to `03 Journal/` on `/new` and `/reset`. Heartbeats handle synthesis/linking and place agent-created drafts in `00 Inbox/` for human promotion into `01 Notes/`.

You need to update two workspace files to reflect this change. Pre-written content is provided — use it as-is, replacing the equivalent sections.

## 1. Update AGENTS.md

Replace the `## Memory` section (and its subsections: `🧠 MEMORY.md`, `📝 Write It Down`, `🔄 Memory Maintenance`) with the content from:
`{{SKILL_PACKAGE_PATH}}/templates/agents-memory.md`

Also replace the `### 🔄 Memory Maintenance (During Heartbeats)` subsection under `## 💓 Heartbeats` with the content from:
`{{SKILL_PACKAGE_PATH}}/templates/agents-heartbeat.md`

Read both template files, substitute `{{VAULT_PATH}}` with `{{VAULT_PATH}}`, and perform the replacements. Keep all other AGENTS.md content unchanged.

## 2. Update HEARTBEAT.md

Replace the content of HEARTBEAT.md with the content from:
`{{SKILL_PACKAGE_PATH}}/templates/heartbeat.md`

## 3. Confirm

After updating both files, reply confirming the changes. Read the `zettelclaw` skill (at `{{SKILL_PACKAGE_PATH}}/SKILL.md`) to familiarize yourself with vault operations.
