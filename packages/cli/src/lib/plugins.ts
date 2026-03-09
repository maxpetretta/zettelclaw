import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
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

type AssetDownloader = (repo: string, releaseTag: string, source: AssetSource) => Promise<Uint8Array | null>

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

const MANAGED_PLUGIN_IDS = [
  ...CORE_PLUGINS.map((plugin) => plugin.id),
  GIT_PLUGIN.id,
  ...MINIMAL_PLUGINS.map((plugin) => plugin.id),
] as const

export const MANAGED_THEME_NAMES = [MINIMAL_THEME.name] as const

export type ManagedPluginId = (typeof MANAGED_PLUGIN_IDS)[number]

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function isManagedPluginId(value: string): value is ManagedPluginId {
  return MANAGED_PLUGIN_IDS.includes(value as ManagedPluginId)
}

export function getManagedPluginIds(options: DownloadOptions): string[] {
  const ids = [CORE_PLUGINS[0]?.id].filter((id): id is string => typeof id === "string")

  if (options.includeGit) {
    ids.push(GIT_PLUGIN.id)
  }

  if (options.includeMinimal) {
    ids.push(...MINIMAL_PLUGINS.map((plugin) => plugin.id))
  }

  return uniqueSortedStrings(ids)
}

export interface ReadEnabledCommunityPluginsResult {
  ids: string[]
  error?: string
}

export async function readEnabledCommunityPlugins(vaultPath: string): Promise<ReadEnabledCommunityPluginsResult> {
  const communityPluginsPath = join(vaultPath, ".obsidian", "community-plugins.json")

  let raw = ""
  try {
    raw = await readFile(communityPluginsPath, "utf8")
  } catch {
    return {
      ids: [],
      error: "community-plugins.json missing",
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ids: [],
      error: "community-plugins.json is not valid JSON",
    }
  }

  const ids = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []
  return { ids: uniqueSortedStrings(ids) }
}

export async function readInstalledManagedPlugins(vaultPath: string): Promise<string[]> {
  const pluginDir = join(vaultPath, ".obsidian", "plugins")

  let entries: string[] = []
  try {
    entries = await readdir(pluginDir)
  } catch {
    return []
  }

  return uniqueSortedStrings(entries.filter((entry) => isManagedPluginId(entry)))
}

export interface ManagedPluginContractState {
  enabled: string[]
  installed: string[]
  missingInstalled: string[]
  extraInstalled: string[]
}

export async function readManagedPluginContractState(
  vaultPath: string,
  enabledPluginIds: readonly string[],
): Promise<ManagedPluginContractState> {
  const enabled = uniqueSortedStrings(enabledPluginIds.filter((id) => isManagedPluginId(id)))
  const installed = await readInstalledManagedPlugins(vaultPath)

  return {
    enabled,
    installed,
    missingInstalled: enabled.filter((id) => !installed.includes(id)),
    extraInstalled: installed.filter((id) => !enabled.includes(id)),
  }
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

async function downloadRelease(
  parentDir: string,
  id: string,
  repo: string,
  releaseTag: string,
  assets: AssetSource[],
  download: AssetDownloader,
): Promise<boolean> {
  const targetDir = join(parentDir, id)
  const stageDir = join(parentDir, `.tmp-${id}-${Date.now()}`)
  await mkdir(stageDir, { recursive: true })

  let success = true

  for (const source of assets) {
    const data = await download(repo, releaseTag, source)

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

  return true
}

export interface DownloadResult {
  downloaded: string[]
  failed: string[]
}

export interface DownloadOptions {
  includeGit: boolean
  includeMinimal: boolean
}

export async function downloadPlugins(
  vaultPath: string,
  options: DownloadOptions,
  download: AssetDownloader = downloadAsset,
): Promise<DownloadResult> {
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
      ok: await downloadRelease(pluginDir, plugin.id, plugin.repo, plugin.releaseTag, plugin.assets, download),
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
    const ok = await downloadRelease(
      themesDir,
      MINIMAL_THEME.name,
      MINIMAL_THEME.repo,
      MINIMAL_THEME.releaseTag,
      MINIMAL_THEME.assets,
      download,
    )

    if (ok) {
      result.downloaded.push("Minimal theme")
    } else {
      result.failed.push("Minimal theme")
    }
  }

  return result
}
