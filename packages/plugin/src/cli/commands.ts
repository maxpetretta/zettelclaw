import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { PluginConfig } from "../config";
import { generateBriefing } from "../briefing/generate";
import { queryLog, searchLog } from "../log/query";
import type { EntryType, LogEntry } from "../log/schema";
import { ensureSubject, readRegistry, renameSubject, writeRegistry } from "../subjects/registry";
import { writeState } from "../state";

export const BRIEFING_BEGIN_MARKER = "<!-- BEGIN GENERATED BRIEFING -->";
export const BRIEFING_END_MARKER = "<!-- END GENERATED BRIEFING -->";

interface CommandLike {
  command(name: string): CommandLike;
  description(text: string): CommandLike;
  option(flag: string, description?: string, defaultValue?: unknown): CommandLike;
  argument(spec: string, description?: string): CommandLike;
  action(handler: (...args: unknown[]) => unknown): CommandLike;
}

interface InitPaths {
  logDir: string;
  logPath: string;
  subjectsPath: string;
  statePath: string;
  openClawConfigPath: string;
  memoryMdPath: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function resolveOpenClawHome(): string {
  const override = process.env.OPENCLAW_HOME?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), ".openclaw");
}

function resolvePaths(config: PluginConfig, workspaceDir?: string): InitPaths {
  const openClawHome = resolveOpenClawHome();
  const resolvedWorkspaceDir = workspaceDir?.trim() || process.cwd();

  return {
    logDir: config.logDir,
    logPath: join(config.logDir, "log.jsonl"),
    subjectsPath: join(config.logDir, "subjects.json"),
    statePath: join(config.logDir, "state.json"),
    openClawConfigPath: join(openClawHome, "openclaw.json"),
    memoryMdPath: join(resolvedWorkspaceDir, "MEMORY.md"),
  };
}

function parseEntryType(raw: unknown): EntryType | undefined {
  if (raw === "task" || raw === "fact" || raw === "decision" || raw === "question" || raw === "handoff") {
    return raw;
  }

  return undefined;
}

function parseStatus(raw: unknown): "open" | "done" | undefined {
  if (raw === "open" || raw === "done") {
    return raw;
  }

  return undefined;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatEntry(entry: LogEntry): string {
  const subject = entry.subject ? ` (${entry.subject})` : "";
  const base = `[${formatTimestamp(entry.timestamp)}] [${entry.type}]${subject} ${entry.content}`;
  if (entry.detail) {
    return `${base}\n  ${entry.detail}`;
  }

  return base;
}

function readNumberOption(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function sortRegistryEntries(registry: Record<string, { display: string; type: string }>): Array<[string, { display: string; type: string }]> {
  return Object.entries(registry).sort(([left], [right]) => left.localeCompare(right));
}

export async function ensureLogStoreFiles(paths: InitPaths): Promise<void> {
  await mkdir(paths.logDir, { recursive: true });

  try {
    await readFile(paths.logPath, "utf8");
  } catch {
    await writeFile(paths.logPath, "", "utf8");
  }

  try {
    await readFile(paths.subjectsPath, "utf8");
  } catch {
    await writeFile(paths.subjectsPath, "{}\n", "utf8");
  }

  try {
    await readFile(paths.statePath, "utf8");
  } catch {
    await writeState(paths.statePath, {
      extractedSessions: {},
      failedSessions: {},
    });
  }
}

export async function updateOpenClawConfigForInit(configPath: string): Promise<void> {
  let current = {};

  try {
    const raw = await readFile(configPath, "utf8");
    current = JSON.parse(raw) as unknown;
  } catch {
    current = {};
  }

  const root = toObject(current);
  const plugins = toObject(root.plugins);
  const slots = toObject(plugins.slots);
  slots.memory = "zettelclaw";
  plugins.slots = slots;
  root.plugins = plugins;

  const agents = toObject(root.agents);
  const defaults = toObject(agents.defaults);
  const compaction = toObject(defaults.compaction);
  compaction.memoryFlush = null;
  defaults.compaction = compaction;
  agents.defaults = defaults;
  root.agents = agents;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
}

export async function ensureMemoryMarkers(memoryMdPath: string): Promise<void> {
  let content = "";

  try {
    content = await readFile(memoryMdPath, "utf8");
  } catch {
    content = "";
  }

  const hasBegin = content.includes(BRIEFING_BEGIN_MARKER);
  const hasEnd = content.includes(BRIEFING_END_MARKER);

  if (hasBegin && hasEnd) {
    return;
  }

  const trimmed = content.trimEnd();
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  const next = `${prefix}${BRIEFING_BEGIN_MARKER}\n${BRIEFING_END_MARKER}\n`;

  await mkdir(dirname(memoryMdPath), { recursive: true });
  await writeFile(memoryMdPath, next, "utf8");
}

export async function runInit(config: PluginConfig, workspaceDir?: string): Promise<InitPaths> {
  const paths = resolvePaths(config, workspaceDir);

  await ensureLogStoreFiles(paths);
  await updateOpenClawConfigForInit(paths.openClawConfigPath);
  await ensureMemoryMarkers(paths.memoryMdPath);

  return paths;
}

function printEntries(entries: LogEntry[]): void {
  if (entries.length === 0) {
    console.log("No entries.");
    return;
  }

  for (const entry of entries) {
    console.log(formatEntry(entry));
  }
}

export function registerZettelclawCli(
  program: unknown,
  config: PluginConfig,
  api: OpenClawPluginApi,
  workspaceDir?: string,
): void {
  const root = program as CommandLike;
  const zettelclaw = root.command("zettelclaw").description("Zettelclaw memory management");

  zettelclaw
    .command("init")
    .description("Initialize zettelclaw memory store and config")
    .action(async () => {
      const paths = await runInit(config, workspaceDir);
      console.log("Zettelclaw initialized.");
      console.log(`Log directory: ${paths.logDir}`);
      console.log(`Config updated: ${paths.openClawConfigPath}`);
      console.log(`MEMORY.md markers ensured: ${paths.memoryMdPath}`);
    });

  zettelclaw
    .command("log")
    .description("Print recent log entries")
    .option("--limit <n>", "Max number of entries", 20)
    .option("--type <type>", "Entry type")
    .option("--subject <slug>", "Subject slug")
    .action(async (opts: unknown) => {
      const options = toObject(opts);
      const paths = resolvePaths(config, workspaceDir);
      const limit = readNumberOption(options.limit, 20);

      const entries = await queryLog(paths.logPath, {
        ...(parseEntryType(options.type) ? { type: parseEntryType(options.type) } : {}),
        ...(typeof options.subject === "string" && options.subject.trim()
          ? { subject: options.subject.trim() }
          : {}),
      });

      printEntries(entries.slice(0, limit));
    });

  zettelclaw
    .command("search [query]")
    .description("Search log entries")
    .option("--type <type>", "Entry type")
    .option("--subject <slug>", "Subject slug")
    .option("--status <status>", "Task status")
    .option("--all", "Include replaced entries", false)
    .action(async (query: unknown, opts: unknown) => {
      const options = toObject(opts);
      const paths = resolvePaths(config, workspaceDir);

      const filter = {
        ...(parseEntryType(options.type) ? { type: parseEntryType(options.type) } : {}),
        ...(typeof options.subject === "string" && options.subject.trim()
          ? { subject: options.subject.trim() }
          : {}),
        ...(parseStatus(options.status) ? { status: parseStatus(options.status) } : {}),
        includeReplaced: options.all === true,
      };

      const entries =
        typeof query === "string" && query.trim().length > 0
          ? await searchLog(paths.logPath, query.trim(), filter)
          : await queryLog(paths.logPath, filter);

      printEntries(entries);
    });

  const subjects = zettelclaw.command("subjects").description("Manage subject registry");

  subjects
    .command("list")
    .description("List subjects")
    .action(async () => {
      const paths = resolvePaths(config, workspaceDir);
      const registry = await readRegistry(paths.subjectsPath);
      const items = sortRegistryEntries(registry);

      if (items.length === 0) {
        console.log("No subjects.");
        return;
      }

      for (const [slug, subject] of items) {
        console.log(`${slug}\t${subject.display}\t(${subject.type})`);
      }
    });

  subjects
    .command("add <slug>")
    .description("Add a subject")
    .option("--type <type>", "Subject type", "project")
    .option("--display <display>", "Display name")
    .action(async (slug: unknown, opts: unknown) => {
      if (typeof slug !== "string" || slug.trim().length === 0) {
        throw new Error("slug is required");
      }

      const options = toObject(opts);
      const paths = resolvePaths(config, workspaceDir);
      const normalizedSlug = slug.trim();
      const inferredType = typeof options.type === "string" && options.type.trim() ? options.type.trim() : "project";

      await ensureSubject(paths.subjectsPath, normalizedSlug, inferredType);

      if (typeof options.display === "string" && options.display.trim()) {
        const registry = await readRegistry(paths.subjectsPath);
        const existing = registry[normalizedSlug];
        if (existing) {
          registry[normalizedSlug] = {
            ...existing,
            display: options.display.trim(),
          };
          await writeRegistry(paths.subjectsPath, registry);
        }
      }

      console.log(`Added subject: ${normalizedSlug}`);
    });

  subjects
    .command("rename <oldSlug> <newSlug>")
    .description("Rename a subject")
    .action(async (oldSlug: unknown, newSlug: unknown) => {
      if (
        typeof oldSlug !== "string" ||
        oldSlug.trim().length === 0 ||
        typeof newSlug !== "string" ||
        newSlug.trim().length === 0
      ) {
        throw new Error("oldSlug and newSlug are required");
      }

      const paths = resolvePaths(config, workspaceDir);
      await renameSubject(paths.subjectsPath, paths.logPath, oldSlug.trim(), newSlug.trim());
      console.log(`Renamed subject: ${oldSlug.trim()} -> ${newSlug.trim()}`);
    });

  const briefing = zettelclaw.command("briefing").description("Briefing generation helpers");

  briefing
    .command("generate")
    .description("Generate and write MEMORY.md briefing block")
    .action(async () => {
      const paths = resolvePaths(config, workspaceDir);
      const apiToken =
        isObject(api.config) &&
        isObject(api.config.gateway) &&
        isObject(api.config.gateway.auth) &&
        typeof api.config.gateway.auth.token === "string" &&
        api.config.gateway.auth.token.trim().length > 0
          ? api.config.gateway.auth.token
          : undefined;

      await generateBriefing({
        logPath: paths.logPath,
        memoryMdPath: paths.memoryMdPath,
        config,
        apiToken,
      });

      console.log(`Briefing updated: ${paths.memoryMdPath}`);
    });
}

export const __cliTestExports = {
  resolvePaths,
};
