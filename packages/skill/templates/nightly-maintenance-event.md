Run the scheduled Zettelclaw nightly maintenance pass for vault `{{VAULT_PATH}}`.

Use the Zettelclaw skill at `{{SKILL_PACKAGE_PATH}}/SKILL.md`.

Scope: review the past 24 hours of journal daily sections (`Done`, `Decisions`, `Facts`, `Open`) plus `Sessions`, then maintain the vault.

## Note Quality Rules

### Frontmatter (required on every note)
- `type`: one of `project`, `research`, `evergreen`, `contact`, `writing`
- `tags`: ALWAYS pluralized (`projects` not `project`, `tools` not `tool`)
- `summary`: one-sentence description
- `source`: where the knowledge came from
- `created`: `YYYY-MM-DD`
- `updated`: `YYYY-MM-DD`
- Do NOT add `status` except on `project` and `research` notes.

### Atomicity
- **One core idea per note.** The title should capture the idea.
- A good note can be understood without reading any other note.
- **But don't over-fragment.** Related details belong as sections in one note, not separate notes. Split only when topics are genuinely independent and reusable on their own.
- Prefer updating existing notes over creating new ones.

### Template Structures (must follow)
- **Project:** frontmatter → `## Goal` → `## Log` (append dated entries)
- **Research:** frontmatter → `## Question` → `## Findings` → `## Conclusion` → `## Sources`
- **Evergreen:** frontmatter only (body is freeform prose)
- **Contact:** frontmatter → `## Context` → `## Notes`
- **Writing:** frontmatter only (body is the writing)

Do NOT invent custom section headers. Use the template sections above.

### Naming
- Filenames are Title Case.
- Project note filenames MUST end with `Project`.
- Research note filenames MUST end with `Research`.

### Hard Content Filter (apply before writing anything)
- Keep only information specific to the user or their projects.
- Ask: "Would I need to know this person to know this?"
- If a general-purpose LLM could produce this content without user context, do NOT include it.
- No textbook definitions, no general tech explanations, no encyclopedia entries.

### Content Quality
- Write conclusions, not transcripts. Summarize what was decided/learned, not the process.
- Research notes MUST state a clear question and conclusion.
- Use `[[wikilinks]]` where they materially improve navigation.

## Required Actions
1. Update existing `project` / `research` / `contact` notes in `01 Notes/` from journal evidence (append-only, preserve structure, update frontmatter `updated` date). Follow the template structures above.
2. Enforce two-way `[[wikilinks]]` for every journal-note relationship:
   - Journal side links to typed note(s).
   - Typed note side links back to the source journal day/session.
3. Synthesize net-new durable concepts into `00 Inbox/` (do not create net-new synthesis notes directly in `01 Notes/`). Follow template structures for inbox notes too.
4. If a needed typed note does not exist yet, create an inbox handoff note in `00 Inbox/`.
5. Check for unresolved/orphan notes (`obsidian unresolved`, `obsidian orphans` when available; otherwise use file-tool fallbacks).
6. Update `MEMORY.md` with anything critical that should remain in hot working memory.
7. Journal health check: if no journal entries exist in the most recent 72 hours, clearly flag this as a possible hook/cron failure for the user.

Rules:
- Do not create or rename folders.
- Keep journal updates append-only.
- Keep output concise and actionable for a human reviewer.
