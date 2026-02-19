import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return homedir();
  }

  if (inputPath.startsWith("~/")) {
    return resolve(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

async function hasObsidianVault(pathToDir: string): Promise<boolean> {
  try {
    await access(join(pathToDir, ".obsidian"));
    return true;
  } catch {
    return false;
  }
}

async function findVaultPath(candidatePath: string): Promise<string | null> {
  const resolved = resolve(expandHome(candidatePath));

  if (await hasObsidianVault(resolved)) {
    return resolved;
  }

  const nestedVault = join(resolved, "vault");
  if (await hasObsidianVault(nestedVault)) {
    return nestedVault;
  }

  try {
    const entries = await readdir(resolved, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const childPath = join(resolved, entry.name);
      if (await hasObsidianVault(childPath)) {
        return childPath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function resolveVaultPath(cfg: unknown, hookConfig: unknown): Promise<string | null> {
  const hookRecord = asRecord(hookConfig);
  const explicitVaultPath = hookRecord.vaultPath;

  if (typeof explicitVaultPath === "string" && explicitVaultPath.trim().length > 0) {
    const resolvedExplicit = resolve(expandHome(explicitVaultPath.trim()));
    const discovered = await findVaultPath(resolvedExplicit);
    return discovered ?? resolvedExplicit;
  }

  const cfgRecord = asRecord(cfg);
  const memorySearch = asRecord(cfgRecord.memorySearch);
  const extraPaths = Array.isArray(memorySearch.extraPaths) ? memorySearch.extraPaths : [];

  for (const candidate of extraPaths) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }

    const resolved = await findVaultPath(candidate);
    if (resolved) {
      return resolved;
    }
  }

  for (const candidate of ["~/dev/obsidian", "~/obsidian", "~/Documents/obsidian"]) {
    const resolved = await findVaultPath(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}
