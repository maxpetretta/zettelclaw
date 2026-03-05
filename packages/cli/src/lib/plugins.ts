import { createHash } from "node:crypto"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

interface AssetSource {
  name: string
  sha256: string
  required: boolean
}

interface PluginSource {
  id: string
  repo: string
  releaseTag: string
  assets: AssetSource[]
}

interface ThemeSource {
  name: string
  repo: string
  releaseTag: string
  assets: AssetSource[]
}

function asset(name: string, sha256: string, required = true): AssetSource {
  return { name, sha256, required }
}

function sha256Hex(value: Uint8Array): string {
  const hash = createHash("sha256")
  hash.update(value)
  return hash.digest("hex")
}

const CORE_PLUGINS: PluginSource[] = [
  {
    id: "calendar",
    repo: "liamcain/obsidian-calendar-plugin",
    releaseTag: "1.5.10",
    assets: [
      asset("main.js", "7fb339e9cf9fdbe5a801fa2b8ab85b366b5b3777fbd193cbc8728bc27711d125"),
      asset("manifest.json", "f3e9581338648512baa12d5b458490f7fd367918f7bdb6bd86171ce57be7d08b"),
    ],
  },
]

const GIT_PLUGIN: PluginSource = {
  id: "obsidian-git",
  repo: "Vinzent03/obsidian-git",
  releaseTag: "2.37.1",
  assets: [
    asset("main.js", "93945328777eaa89f5f7bb0281c28ac95484dac654b6026343c6b2fff1bfa6b7"),
    asset("manifest.json", "ae6e1b75dee4bbee72a3edb224e49890da97bcf544089b0d1c0d550fca88acd9"),
    asset("styles.css", "266bd2569f18bed0ac0c736b522ca2084dee1f92df017e7d213b4559a97c7cef", false),
  ],
}

const MINIMAL_PLUGINS: PluginSource[] = [
  {
    id: "obsidian-minimal-settings",
    repo: "kepano/obsidian-minimal-settings",
    releaseTag: "8.2.1",
    assets: [
      asset("main.js", "2f67e67a926c343ba9418eab48ca19ce828216d2a1b9fac975600ed3826000c9"),
      asset("manifest.json", "4cafba3fed9b730c86c97eecb3809ef550473fe331230686e1f6bdf40775e6f3"),
      asset("styles.css", "50084760da927a5bf5ac1b9d3b960dc52e1d0a3bf690e54df8f4d76f8212628c", false),
    ],
  },
  {
    id: "obsidian-hider",
    repo: "kepano/obsidian-hider",
    releaseTag: "1.6.1",
    assets: [
      asset("main.js", "b83019dfbf5f1722eea78ce154ec61bf699ac4583b85f733bb5fdeab182fae5a"),
      asset("manifest.json", "94813a6d8aa6803b7630f6ea4e7ed6e4a8caf9a0e16f57c3baef496a5f8ffdb9"),
      asset("styles.css", "6b6cd096c1751a5f08ea2512e1cbacf9f071ddde72c060d8dfbcb3d93fc28316", false),
    ],
  },
]

const MINIMAL_THEME: ThemeSource = {
  name: "Minimal",
  repo: "kepano/obsidian-minimal",
  releaseTag: "8.1.5",
  assets: [
    asset("manifest.json", "5d3d800cfb0bd33a45fe6cc4ce398eff66c38b4edbe823d7e13e9cf83e219035"),
    asset("theme.css", "59ae8f6a22dc113bfbf876c3fa5d55a78d3bfaee67ebc314faa11bef012eaedd"),
  ],
}

async function downloadAsset(repo: string, releaseTag: string, source: AssetSource): Promise<Uint8Array | null> {
  const url = `https://github.com/${repo}/releases/download/${releaseTag}/${source.name}`

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      return null
    }

    const downloaded = new Uint8Array(await response.arrayBuffer())
    const digest = sha256Hex(downloaded)
    if (digest !== source.sha256.toLowerCase()) {
      return null
    }

    return downloaded
  } catch {
    return null
  }
}

async function downloadPlugin(pluginDir: string, plugin: PluginSource): Promise<boolean> {
  const targetDir = join(pluginDir, plugin.id)
  const stageDir = join(pluginDir, `.tmp-${plugin.id}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })

  let success = true

  for (const source of plugin.assets) {
    const data = await downloadAsset(plugin.repo, plugin.releaseTag, source)

    if (data !== null) {
      await writeFile(join(stageDir, source.name), data)
    } else if (source.required) {
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

async function downloadTheme(themesDir: string, theme: ThemeSource): Promise<boolean> {
  const targetDir = join(themesDir, theme.name)
  const stageDir = join(themesDir, `.tmp-${theme.name}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })

  let success = true

  for (const source of theme.assets) {
    const data = await downloadAsset(theme.repo, theme.releaseTag, source)

    if (data !== null) {
      await writeFile(join(stageDir, source.name), data)
    } else if (source.required) {
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
