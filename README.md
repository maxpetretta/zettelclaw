# zettelclaw

Zettelclaw ships two things in this repository:

- `vault/`: a ready-to-open Obsidian vault template.
- `zettelclaw` CLI: Bun + TypeScript setup/upgrade tool.

## Install dependencies

```bash
bun install
```

## Run the CLI locally

```bash
bun run src/index.ts init
bun run src/index.ts init --openclaw
bun run src/index.ts upgrade
```

`init` now prompts for only:
- vault path
- sync method (Git, Obsidian Sync, None)

Everything else is defaulted or controlled by flags such as `--root`, `--minimal`, `--no-git`, and `--no-openclaw`.

## Binary metadata

- Package name: `zettelclaw`
- Binary name: `zettelclaw`
