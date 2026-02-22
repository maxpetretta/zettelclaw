#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(scriptDir, "..")
const workspaceSkillRoot = resolve(cliRoot, "..", "skill")
const bundledSkillRoot = join(cliRoot, "skill")

async function copyEntry(name) {
  await cp(join(workspaceSkillRoot, name), join(bundledSkillRoot, name), { recursive: true })
}

async function main() {
  await rm(bundledSkillRoot, { recursive: true, force: true })
  await mkdir(bundledSkillRoot, { recursive: true })

  await copyEntry("SKILL.md")
  await copyEntry("hooks")
  await copyEntry("templates")
  await copyEntry("package.json")
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Could not sync skill assets: ${message}`)
  process.exit(1)
})
