import { access, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

export async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export async function walkFiles(baseDir: string, relativeDir = ""): Promise<string[]> {
  const currentDir = relativeDir ? join(baseDir, ...relativeDir.split("/")) : baseDir
  const entries = await readdir(currentDir, { withFileTypes: true })

  const files: string[] = []

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(baseDir, relativePath)))
      continue
    }

    files.push(relativePath)
  }

  return files
}

export async function writeFileIfMissing(pathToFile: string, content: string): Promise<void> {
  if (await pathExists(pathToFile)) {
    return
  }

  await mkdir(dirname(pathToFile), { recursive: true })
  await writeFile(pathToFile, content, "utf8")
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as T
}

export async function readJsonFileOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(path)
  } catch {
    return fallback
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}
