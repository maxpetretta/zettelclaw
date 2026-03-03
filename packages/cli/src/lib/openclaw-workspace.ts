import { dirname, join } from "node:path"

export interface OpenClawWorkspaceEnv {
  stateDir: string
  configPath: string
}

export function resolveOpenClawEnvForWorkspace(workspacePath: string): OpenClawWorkspaceEnv {
  const stateDir = dirname(workspacePath)
  return {
    stateDir,
    configPath: join(stateDir, "openclaw.json"),
  }
}

export function configureOpenClawEnvForWorkspace(workspacePath: string): OpenClawWorkspaceEnv {
  const env = resolveOpenClawEnvForWorkspace(workspacePath)
  process.env.OPENCLAW_STATE_DIR = env.stateDir
  process.env.OPENCLAW_CONFIG_PATH = env.configPath
  return env
}
