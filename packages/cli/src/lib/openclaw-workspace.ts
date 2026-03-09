import { dirname, join } from "node:path"

export interface OpenClawWorkspaceEnv {
  stateDir: string
  configPath: string
}

export function configureOpenClawEnvForWorkspace(workspacePath: string): OpenClawWorkspaceEnv {
  const stateDir = dirname(workspacePath)
  const configPath = join(stateDir, "openclaw.json")
  process.env.OPENCLAW_STATE_DIR = stateDir
  process.env.OPENCLAW_CONFIG_PATH = configPath
  return { stateDir, configPath }
}
