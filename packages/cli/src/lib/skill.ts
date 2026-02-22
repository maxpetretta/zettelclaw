import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)
let cachedSkillPackageDir: string | null = null

function looksLikeSkillPackage(pathToDir: string): boolean {
  return existsSync(join(pathToDir, "SKILL.md")) && existsSync(join(pathToDir, "hooks"))
}

export function resolveSkillPackageDir(): string {
  if (cachedSkillPackageDir) {
    return cachedSkillPackageDir
  }

  try {
    const packageJsonPath = require.resolve("@zettelclaw/skill/package.json")
    cachedSkillPackageDir = dirname(packageJsonPath)
    return cachedSkillPackageDir
  } catch {
    // Fall through to bundled/local skill candidates.
  }

  const candidates = [
    resolve(import.meta.dirname, "..", "..", "skill"),
    resolve(import.meta.dirname, "..", "skill"),
    resolve(import.meta.dirname, "..", "..", "..", "skill"),
  ] as const

  for (const candidate of candidates) {
    if (looksLikeSkillPackage(candidate)) {
      cachedSkillPackageDir = candidate
      return cachedSkillPackageDir
    }
  }

  throw new Error(`Could not resolve Zettelclaw skill package. Tried: ${candidates.join(", ")}`)
}

export function resolveSkillPath(...parts: string[]): string {
  return join(resolveSkillPackageDir(), ...parts)
}
