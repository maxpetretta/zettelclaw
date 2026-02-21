import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
let cachedSkillPackageDir: string | null = null

export function resolveSkillPackageDir(): string {
  if (cachedSkillPackageDir) {
    return cachedSkillPackageDir
  }

  try {
    const packageJsonPath = require.resolve("@zettelclaw/skill/package.json")
    cachedSkillPackageDir = dirname(packageJsonPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not resolve @zettelclaw/skill package: ${message}`)
  }

  return cachedSkillPackageDir
}

export function resolveSkillPath(...parts: string[]): string {
  return join(resolveSkillPackageDir(), ...parts)
}
