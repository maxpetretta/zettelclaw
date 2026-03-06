# Zettelclaw Spec

> High-level product spec for the implemented system. This is the contract a coding agent should preserve when reimplementing or extending Zettelclaw.

## Summary

Zettelclaw is an opinionated Obsidian vault system for human/agent knowledge work.

The current implementation is not an Obsidian plugin. It is a Bun/TypeScript monorepo that ships:

- a CLI that scaffolds and verifies a vault
- a reusable agent skill that teaches agents how to operate in that vault
- a small marketing website

The core workflow is:

1. Capture external content into an inbox.
2. Write durable notes in markdown.
3. Let an agent read, search, and navigate the vault.
4. Use the CLI to keep the local setup consistent.

The system is optimized for "human writes durable knowledge, agent reads and assists".

## Product Surfaces

| Package | Role |
| --- | --- |
| `packages/cli` | Ships the `zettelclaw` CLI. Handles `init` and `verify`, seeds the vault, configures Obsidian files, installs plugin assets, sets up QMD, patches OpenClaw memory paths, and installs the bundled OpenClaw skill. |
| `packages/skill` | Ships `@zettelclaw/skill`, a skill package that teaches any compatible agent the vault conventions, schemas, and search patterns. |
| `packages/website` | Marketing site only. Not part of the runtime contract. |

## Core Principles

- Durable knowledge lives in markdown notes written by the human.
- Agents are readers, search tools, and synthesizers, not autonomous note authors.
- The vault should stay simple: flat folders, typed frontmatter, minimal templates.
- Internal relationships are expressed with wikilinks, not folder hierarchies or heavy metadata.
- The system should work without cloud services. OpenClaw and QMD are local integrations.

## Canonical Vault Contract

Every initialized vault must contain these top-level directories:

```text
00 Inbox/
01 Notes/
02 Journal/
03 Templates/
04 Attachments/
README.md
```

Notes are organized by links and metadata, not nested content folders.

### Folder semantics

| Path | Purpose |
| --- | --- |
| `00 Inbox/` | Unprocessed captures from the web clipper. |
| `01 Notes/` | Durable notes, content references, and docs. |
| `02 Journal/` | Daily journal files named `YYYY-MM-DD.md`. |
| `03 Templates/` | Markdown templates plus the web clipper JSON template. |
| `04 Attachments/` | Files embedded in notes. |

### Seeded starter files

`zettelclaw init` also creates example content:

- `01 Notes/Zettelclaw Vault Principles.md`
- `00 Inbox/Build A Capture Habit.md`
- `02 Journal/<today>.md`

These are onboarding examples, not reserved system files.

### README contract

The generated vault README is human-facing. It summarizes the folders, templates, Base view, QMD collections, OpenClaw memory-path integration, and points the user to the agent skill.

The vault does not include root `AGENTS.md` or `CLAUDE.md` files in the current implementation.

## Note Model

Zettelclaw uses typed frontmatter on every markdown note.

### Required properties

| Property | Type | Notes |
| --- | --- | --- |
| `type` | string | Required on all notes. |
| `tags` | string array | Required on all notes. |
| `created` | `YYYY-MM-DD` date string | Required on all notes. |
| `status` | string | Required for `doc` and content notes; omitted for `note` and `journal`. |

### Optional content metadata

| Property | Type | Notes |
| --- | --- | --- |
| `author` | string | Optional source author/creator. |
| `source` | string | Optional URL or reference identifier. |

### Core note types

| Type | Meaning |
| --- | --- |
| `note` | Durable atomic thought in the user's own words. |
| `doc` | Multi-section working/reference document. |
| `journal` | Daily log entry. |
| `article` | Web article or essay. |
| `youtube` | YouTube capture. |
| `tweet` | X/Twitter capture. |
| `book`, `movie`, `tv`, `podcast`, `paper` | Manual content/reference note types supported by convention. |

Additional content types are allowed. The schema is extensible by `type` value rather than code changes.

### Status lifecycle

The shared `status` values are:

```text
queued -> in-progress -> done -> archived
```

`status` is used for docs and content notes. It is not used for `note` or `journal`.

### Frontmatter examples

Durable note:

```yaml
---
type: note
tags: [learning, memory]
created: 2026-03-06
---
```

Content note:

```yaml
---
type: article
status: queued
tags: [reading, ai]
author: Example Author
source: https://example.com/post
created: 2026-03-06
---
```

### Content conventions

- Tags live in the frontmatter `tags` array, not inline in the body.
- Tags should usually be lowercase and hyphenated; shallow nesting like `ai/transformers` is allowed.
- Internal links use Obsidian wikilinks such as `[[Retrieval Practice]]`.
- Unresolved wikilinks are acceptable and act as future-note stubs.
- Durable `note` titles should be complete, descriptive phrases rather than short topic labels.

## Templates And Capture Contract

The seeded vault includes three templates:

- `03 Templates/note.md`
- `03 Templates/journal.md`
- `03 Templates/clipper-capture.json`

### Markdown templates

`note.md`:

```markdown
---
type: note
tags: []
created: {{date:YYYY-MM-DD}}
---
```

`journal.md`:

```markdown
---
type: journal
tags: []
created: {{date:YYYY-MM-DD}}
---
```

These use Obsidian core template variables. Templater is not part of the intended system.

### Web clipper contract

The clipper template writes notes into `00 Inbox/`.

Required behaviors:

- note filename format is date-prefixed
- `type` is inferred from the URL
- `status` defaults to `queued`
- `source` is the captured URL
- `author` is populated from page metadata when available
- `created` is the capture date

Current type classification rules:

- YouTube URL -> `youtube`
- X/Twitter URL -> `tweet`
- everything else -> `article`

Current default tag classes are broad, source-shaped tags:

- YouTube -> `video`
- X/Twitter -> `social-media`
- everything else -> `reading`

The captured note body contains a summary section and a captured-content section.

## Inbox And Base Contract

The inbox is a processing queue, not a permanent folder.

Expected actions on inbox items:

- keep and later process
- move into durable notes as a content/reference file
- write a separate `type: note` from it
- delete it

The vault ships one canonical Base view at `00 Inbox/inbox.base`.

It must:

- query markdown files in `00 Inbox`
- present a table view named `Inbox`
- group by `note.type`
- expose ordering fields around `file.name`, `type`, `status`, `author`, `source`, and `created`

Illustrative shape:

```yaml
filters:
  and:
    - file.inFolder("00 Inbox")
    - 'file.ext == "md"'

views:
  - type: table
    name: "Inbox"
    groupBy:
      property: note.type
```

Dataview is not part of the intended implementation.

## Obsidian Configuration Contract

`zettelclaw init` writes Obsidian config files under `.obsidian/`.

### Required app-level settings

| Setting | Value |
| --- | --- |
| New notes folder | `01 Notes` |
| Attachments folder | `04 Attachments` |
| Daily notes folder | `02 Journal` |
| Daily note format | `YYYY-MM-DD` |
| Daily note template | `03 Templates/journal.md` |
| Templates folder | `03 Templates` |
| Properties in document | `source` |
| Backlinks in document | `false` |
| Live Preview | enabled by default |

The workspace template also enables stacked tabs and seeds a right sidebar with calendar/backlinks/outgoing links/outline.

### Managed plugins

Zettelclaw manages a small set of Obsidian community plugins by downloading pinned release assets.

Required:

- `calendar`

Optional by preset:

- `obsidian-git` when sync mode is `git`
- `obsidian-minimal-settings` and `obsidian-hider` when theme preset is `minimal`

Theme presets:

- `obsidian`
- `minimal`

The minimal preset also installs the `Minimal` theme.

## CLI Contract

The CLI entrypoint is `zettelclaw`.

### Commands

```bash
zettelclaw init [--vault <path>] [--workspace <path>] [--sync <git|obsidian-sync|none>] [--theme <minimal|obsidian>] [--yes]
zettelclaw verify [--vault <path>] [--workspace <path>] [--yes]
```

### `init`

`init` is responsible for:

- creating or normalizing the canonical vault folder structure
- migrating supported legacy folder aliases into canonical names when possible
- copying the vault seed files
- creating starter content
- writing `.obsidian` config
- enabling the managed community plugin list
- downloading managed plugin/theme assets
- creating QMD collections if `qmd` is available
- patching OpenClaw memory paths if an OpenClaw workspace exists
- overwriting the managed `zettelclaw` skill install inside the OpenClaw state directory if an OpenClaw workspace exists
- running `git init` when sync mode is `git` and the vault is not already a repository

Default paths:

- vault: `~/zettelclaw`
- OpenClaw workspace: `~/.openclaw/workspace`

### `verify`

`verify` validates the installed contract at a high level. It checks:

- vault structure looks like a Zettelclaw vault
- required plugins are enabled and managed assets are present
- key settings artifacts exist
- the inbox Base exists
- required templates exist
- QMD collections exist when `qmd` is healthy
- OpenClaw config exists and includes the vault in memory paths

`verify` is an integrity check, not a full diff against every config field.

## Integration Contracts

### Agent skill

Agent behavior is taught through `@zettelclaw/skill`, not vault-local agent boot files.

When an OpenClaw workspace is available, `init` installs the bundled skill into the OpenClaw state directory under `skills/zettelclaw`, overwriting any existing copy. Failure to install the skill should be surfaced as a warning rather than aborting vault setup.

The skill defines:

- folder meanings
- note schemas
- linking and tagging conventions
- inbox workflow
- search patterns
- guardrails about what an agent may and may not edit

The skill is the cross-agent interface for Codex, Claude Code, OpenCode, OpenClaw, and similar tools.

### OpenClaw

If an OpenClaw workspace is present, `init` patches the config file in the parent of the workspace directory.

The required config path is:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "extraPaths": ["/path/to/vault"]
      }
    }
  }
}
```

Legacy top-level `memorySearch` is migrated away from and should not be written by new code.

### QMD

QMD is optional but first-class.

When available, Zettelclaw creates these collections:

- `zettelclaw-inbox`
- `zettelclaw-notes`
- `zettelclaw-journal`
- `zettelclaw-attachments`

Each collection indexes markdown files in its corresponding folder.

If QMD is unavailable, the system still works with ripgrep-based search patterns taught by the skill.

## Guardrails And Non-Goals

- No Obsidian plugin package is part of the current implementation.
- No Dataview dependency.
- No Templater dependency.
- No Obsidian Linter dependency.
- No vault-local `AGENTS.md` or `CLAUDE.md` in generated vaults.
- No deep folder hierarchy for notes.
- Agent write access is intentionally narrow: operational journal/response content is acceptable, durable human-authored note prose is not changed by default.
- The agent should not auto-write durable `type: note` content unless explicitly asked.
- The website is non-authoritative for runtime behavior.

## Reimplementation Checklist

A compatible reimplementation should preserve these behaviors:

1. Ship a CLI that can initialize and verify the vault.
2. Generate the canonical vault structure, templates, Base view, starter files, and Obsidian config.
3. Use the typed frontmatter schema and shared `status` lifecycle above.
4. Provide a reusable agent skill instead of vault-local agent boot files.
5. Integrate with OpenClaw via `agents.defaults.memorySearch.extraPaths`.
6. Integrate with QMD via the four canonical collection names when available.
7. Keep durable knowledge in markdown files and treat the agent as a reader/assistant, not the author of record.
