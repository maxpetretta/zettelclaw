import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export async function withTempDir<T>(prefix: string, run: (path: string) => Promise<T>): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), prefix))

  try {
    return await run(path)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}

export async function createTempVault(prefix = "zettelclaw-vault-"): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(path, ".obsidian"), { recursive: true })
  return path
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

export async function writeTextFile(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, "utf8")
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, "utf8")
}

export async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeTextFile(path, contents)
  await chmod(path, 0o755)
}

export async function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}
