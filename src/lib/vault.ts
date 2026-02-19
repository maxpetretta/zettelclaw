import { access, copyFile, mkdir, readdir, readlink, lstat, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type NotesMode = "notes" | "root";

export interface CopyResult {
  added: string[];
  skipped: string[];
}

export interface ApplyVaultTemplateOptions {
  mode: NotesMode;
  overwrite: boolean;
}

const TEMPLATE_ROOT = resolve(import.meta.dir, "..", "..", "vault-template");
const AGENT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
] as const;

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function directoryHasEntries(path: string): Promise<boolean> {
  const entries = await readdir(path);
  return entries.length > 0;
}

async function walkFiles(baseDir: string, relativeDir = ""): Promise<string[]> {
  const currentDir = relativeDir ? join(baseDir, relativeDir) : baseDir;
  const entries = await readdir(currentDir, { withFileTypes: true });

  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(baseDir, relativePath)));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function shouldSkipForMode(relativePath: string, mode: NotesMode): boolean {
  if (mode !== "root") {
    return false;
  }

  return relativePath === "Notes/.gitkeep" || relativePath.startsWith("Notes/");
}

export async function applyVaultTemplate(
  vaultPath: string,
  options: ApplyVaultTemplateOptions,
): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true });

  const files = await walkFiles(TEMPLATE_ROOT);
  const result: CopyResult = {
    added: [],
    skipped: [],
  };

  for (const relativePath of files) {
    if (shouldSkipForMode(relativePath, options.mode)) {
      continue;
    }

    const source = join(TEMPLATE_ROOT, relativePath);
    const destination = join(vaultPath, relativePath);

    await mkdir(dirname(destination), { recursive: true });

    const exists = await pathExists(destination);

    if (exists && !options.overwrite) {
      result.skipped.push(relativePath);
      continue;
    }

    await copyFile(source, destination);
    result.added.push(relativePath);
  }

  return result;
}

export async function detectNotesMode(vaultPath: string): Promise<NotesMode> {
  if (await pathExists(join(vaultPath, "Notes"))) {
    return "notes";
  }

  return "root";
}

export async function createAgentSymlinks(
  vaultPath: string,
  workspacePath: string,
): Promise<CopyResult> {
  const agentDir = join(vaultPath, "Agent");
  await mkdir(agentDir, { recursive: true });

  const result: CopyResult = {
    added: [],
    skipped: [],
  };

  for (const file of AGENT_FILES) {
    const linkPath = join(agentDir, file);
    const targetPath = join(workspacePath, file);

    if (await pathExists(linkPath)) {
      const stats = await lstat(linkPath);

      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (existingTarget === targetPath) {
          result.skipped.push(`Agent/${file}`);
          continue;
        }
      }

      result.skipped.push(`Agent/${file}`);
      continue;
    }

    await symlink(targetPath, linkPath);
    result.added.push(`Agent/${file}`);
  }

  return result;
}
