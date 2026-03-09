import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { resolveOpenClawWorkspaceEnv } from "./openclaw-workspace"
import { resolveSkillPackageDir } from "./skill"

export const OPENCLAW_SKILLS_DIRNAME = "skills"
export const ZETTELCLAW_SKILL_SLUG = "zettelclaw"

export interface InstallOpenClawSkillResult {
  installedPath: string
  sourcePath: string
}

export function resolveOpenClawSkillInstallPath(stateDir: string): string {
  return join(stateDir, OPENCLAW_SKILLS_DIRNAME, ZETTELCLAW_SKILL_SLUG)
}

export async function installOpenClawSkillForWorkspace(workspacePath: string): Promise<InstallOpenClawSkillResult> {
  const { stateDir } = resolveOpenClawWorkspaceEnv(workspacePath)
  const sourcePath = resolveSkillPackageDir()
  const installedPath = resolveOpenClawSkillInstallPath(stateDir)

  await mkdir(join(stateDir, OPENCLAW_SKILLS_DIRNAME), { recursive: true })
  await rm(installedPath, { recursive: true, force: true })
  await cp(sourcePath, installedPath, { recursive: true, force: true })

  return {
    installedPath,
    sourcePath,
  }
}
