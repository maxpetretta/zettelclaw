import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

interface PluginSource {
  id: string
  repo: string
  assets: string[]
}

interface ThemeSource {
  name: string
  repo: string
  assets: string[]
}

const CORE_PLUGINS: PluginSource[] = [
  {
    id: "templater-obsidian",
    repo: "SilentVoid13/Templater",
    assets: ["main.js", "manifest.json", "styles.css"],
  },
  {
    id: "obsidian-linter",
    repo: "platers/obsidian-linter",
    assets: ["main.js", "manifest.json", "styles.css"],
  },
]

const GIT_PLUGIN: PluginSource = {
  id: "obsidian-git",
  repo: "Vinzent03/obsidian-git",
  assets: ["main.js", "manifest.json", "styles.css"],
}

const MINIMAL_PLUGINS: PluginSource[] = [
  {
    id: "obsidian-minimal-settings",
    repo: "kepano/obsidian-minimal-settings",
    assets: ["main.js", "manifest.json", "styles.css"],
  },
  {
    id: "obsidian-hider",
    repo: "kepano/obsidian-hider",
    assets: ["main.js", "manifest.json", "styles.css"],
  },
]

const MINIMAL_THEME: ThemeSource = {
  name: "Minimal",
  repo: "kepano/obsidian-minimal",
  assets: ["manifest.json", "theme.css"],
}

async function downloadAsset(repo: string, asset: string): Promise<Buffer | null> {
  const url = `https://github.com/${repo}/releases/latest/download/${asset}`

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      return null
    }

    return Buffer.from(await response.arrayBuffer())
  } catch {
    return null
  }
}

async function downloadPlugin(pluginDir: string, plugin: PluginSource): Promise<boolean> {
  const targetDir = join(pluginDir, plugin.id)
  const stageDir = join(pluginDir, `.tmp-${plugin.id}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })

  let success = true

  for (const asset of plugin.assets) {
    const data = await downloadAsset(plugin.repo, asset)

    if (data !== null) {
      await writeFile(join(stageDir, asset), data)
    } else if (asset === "main.js" || asset === "manifest.json") {
      success = false
    }
    // styles.css is optional — missing is fine
  }

  if (!success) {
    await rm(stageDir, { recursive: true, force: true })
    return false
  }

  await rm(targetDir, { recursive: true, force: true })
  await rename(stageDir, targetDir)

  return success
}

async function downloadTheme(themesDir: string, theme: ThemeSource): Promise<boolean> {
  const targetDir = join(themesDir, theme.name)
  const stageDir = join(themesDir, `.tmp-${theme.name}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })

  let success = true

  for (const asset of theme.assets) {
    const data = await downloadAsset(theme.repo, asset)

    if (data !== null) {
      await writeFile(join(stageDir, asset), data)
    } else {
      success = false
    }
  }

  if (!success) {
    await rm(stageDir, { recursive: true, force: true })
    return false
  }

  await rm(targetDir, { recursive: true, force: true })
  await rename(stageDir, targetDir)

  return success
}

export interface DownloadResult {
  downloaded: string[]
  failed: string[]
}

export interface DownloadOptions {
  includeGit: boolean
  includeMinimal: boolean
}

export async function downloadPlugins(vaultPath: string, options: DownloadOptions): Promise<DownloadResult> {
  const pluginDir = join(vaultPath, ".obsidian", "plugins")
  const result: DownloadResult = { downloaded: [], failed: [] }

  const plugins: PluginSource[] = [...CORE_PLUGINS]

  if (options.includeGit) {
    plugins.push(GIT_PLUGIN)
  }

  if (options.includeMinimal) {
    plugins.push(...MINIMAL_PLUGINS)
  }

  const pluginOutcomes = await Promise.all(
    plugins.map(async (plugin) => ({
      plugin,
      ok: await downloadPlugin(pluginDir, plugin),
    })),
  )

  for (const outcome of pluginOutcomes) {
    if (outcome.ok) {
      result.downloaded.push(outcome.plugin.id)
    } else {
      result.failed.push(outcome.plugin.id)
    }
  }

  if (options.includeMinimal) {
    const themesDir = join(vaultPath, ".obsidian", "themes")
    const ok = await downloadTheme(themesDir, MINIMAL_THEME)

    if (ok) {
      result.downloaded.push("Minimal theme")
    } else {
      result.failed.push("Minimal theme")
    }
  }

  return result
}
