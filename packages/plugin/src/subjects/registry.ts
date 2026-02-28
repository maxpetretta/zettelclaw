import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Subject {
  display: string;
  type: string;
}

export type SubjectRegistry = Record<string, Subject>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRegistry(raw: unknown): SubjectRegistry {
  if (!isObject(raw)) {
    return {};
  }

  const normalized: SubjectRegistry = {};

  for (const [slug, value] of Object.entries(raw)) {
    if (!isObject(value)) {
      continue;
    }

    if (!isNonEmptyString(value.display) || !isNonEmptyString(value.type)) {
      continue;
    }

    normalized[slug] = {
      display: value.display,
      type: value.type,
    };
  }

  return normalized;
}

export function slugToDisplay(slug: string): string {
  return slug
    .split(/[-_]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export async function readRegistry(path: string): Promise<SubjectRegistry> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return {};
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return normalizeRegistry(parsed);
}

export async function writeRegistry(path: string, registry: SubjectRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export async function ensureSubject(
  path: string,
  slug: string,
  inferredType?: string,
): Promise<void> {
  if (!isNonEmptyString(slug)) {
    throw new Error("slug must be a non-empty string");
  }

  const registry = await readRegistry(path);
  if (registry[slug]) {
    return;
  }

  registry[slug] = {
    display: slugToDisplay(slug),
    type: isNonEmptyString(inferredType) ? inferredType : "project",
  };

  await writeRegistry(path, registry);
}

export async function renameSubject(
  registryPath: string,
  logPath: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  if (!isNonEmptyString(oldSlug) || !isNonEmptyString(newSlug)) {
    throw new Error("oldSlug and newSlug must be non-empty strings");
  }

  if (oldSlug === newSlug) {
    return;
  }

  const registry = await readRegistry(registryPath);
  let registryChanged = false;

  const oldSubject = registry[oldSlug];
  if (oldSubject) {
    if (!registry[newSlug]) {
      registry[newSlug] = oldSubject;
    }

    delete registry[oldSlug];
    registryChanged = true;
  }

  if (registryChanged) {
    await writeRegistry(registryPath, registry);
  }

  let logContent: string;
  try {
    logContent = await readFile(logPath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return;
    }

    throw error;
  }

  const pattern = new RegExp(`(\\"subject\\"\\s*:\\s*\\")${escapeRegex(oldSlug)}(\\")`, "g");
  const updated = logContent.replace(pattern, `$1${newSlug}$2`);

  if (updated !== logContent) {
    await writeFile(logPath, updated, "utf8");
  }
}
