#!/usr/bin/env node

import { dirname, resolve } from "node:path"
import { existsSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"

const binDir = dirname(fileURLToPath(import.meta.url))
const entryPath = resolve(binDir, "..", "dist", "index.js")

if (!existsSync(entryPath)) {
  console.error("Missing dist build for zettelclaw CLI. Reinstall the package or run `bun run build`.")
  process.exit(1)
}

await import(pathToFileURL(entryPath).href)
