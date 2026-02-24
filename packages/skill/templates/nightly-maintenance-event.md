Run the scheduled Zettelclaw nightly maintenance pass for vault `{{VAULT_PATH}}`.

Use the Zettelclaw skill at `{{SKILL_PACKAGE_PATH}}/SKILL.md`.

Scope: review the past 24 hours of journal `Log` and `Todo` sections plus `Sessions`, then maintain the vault.

## Note Quality Rules

### Frontmatter
- `type`: one of `project`, `research`, `evergreen`, `contact`
- `tags`: ALWAYS pluralized
- `summary`: one-sentence description
- `created`: `YYYY-MM-DD`
- `updated`: `YYYY-MM-DD`

### What Makes a Good Note
- A good note makes a **claim**, not a **topic**. The title is a statement, not a category.
- The body is 1-3 short paragraphs, not a wiki article or reference doc.
- **Don't write inventories.** Dependency lists, version numbers, and config dumps are not notes — decisions and insights are.

### Atomicity
- **One claim per note.** Prefer updating existing notes over creating new ones.
- Project notes are the exception — they're containers with Goal + Log.

### Template Structures (must follow)
- **Project:** frontmatter → `## Goal` → `## Log` (dated entries only, no custom sections)
- **Research:** frontmatter → `## Question` → `## Findings` → `## Conclusion` → `## Sources`
- **Evergreen:** frontmatter only (body is 1-3 paragraphs arguing the claim)
- **Contact:** frontmatter → `## Context` → `## Notes`

Do NOT invent custom section headers.

### Hard Content Filter
- Keep only information specific to the user or their projects.
- Ask: "Would I need to know this person to know this?"
- No general knowledge, no dependency lists unless they represent a decision.

## Required Actions
1. Update existing `project` / `research` / `contact` notes in `01 Notes/` from journal evidence (append-only, update `updated` date). Follow template structures.
2. Enforce two-way `[[wikilinks]]` for every journal-note relationship.
3. Synthesize net-new durable concepts into `00 Inbox/`.
4. If a needed typed note does not exist yet, create an inbox handoff note in `00 Inbox/`.
5. Check for unresolved/orphan notes.
6. Update `MEMORY.md` with anything critical for hot working memory.
7. Journal health check: flag if no entries exist in the most recent 72 hours.

Rules:
- Do not create or rename folders.
- Keep journal updates append-only.
- Keep output concise and actionable.
