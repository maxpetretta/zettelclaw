import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type NotesMode = "notes" | "root";
export type SyncMethod = "git" | "obsidian-sync" | "none";

export interface CopyResult {
  added: string[];
  skipped: string[];
}

export interface CopyVaultOptions {
  mode: NotesMode;
  overwrite: boolean;
}

interface CorePlugins {
  [pluginId: string]: boolean;
}

const TEMPLATE_ROOT = resolve(import.meta.dir, "..", "..", "vault");
const AGENT_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
] as const;

const TEMPLATE_FILES = ["daily.md", "note.md", "project.md", "research.md", "contact.md", "writing.md"];

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

export async function copyVaultSeed(vaultPath: string, options: CopyVaultOptions): Promise<CopyResult> {
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

export async function copyVaultTemplatesOnly(vaultPath: string, overwrite: boolean): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true });

  const templateFiles = await walkFiles(join(TEMPLATE_ROOT, "Templates"));
  const result: CopyResult = {
    added: [],
    skipped: [],
  };

  for (const relativePath of templateFiles) {
    const source = join(TEMPLATE_ROOT, "Templates", relativePath);
    const destination = join(vaultPath, "Templates", relativePath);

    await mkdir(dirname(destination), { recursive: true });

    const exists = await pathExists(destination);

    if (exists && !overwrite) {
      result.skipped.push(join("Templates", relativePath));
      continue;
    }

    await copyFile(source, destination);
    result.added.push(join("Templates", relativePath));
  }

  return result;
}

export async function detectNotesMode(vaultPath: string): Promise<NotesMode> {
  if (await pathExists(join(vaultPath, "Notes"))) {
    return "notes";
  }

  return "root";
}

export async function removePathIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
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

  // Once real symlinks are present, the placeholder keeper is unnecessary.
  await removePathIfExists(join(agentDir, ".gitkeep"));

  return result;
}

export async function configureAgentFolder(vaultPath: string, enabled: boolean): Promise<void> {
  if (!enabled) {
    await removePathIfExists(join(vaultPath, "Agent"));
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function configureApp(pathToVault: string, mode: NotesMode): Promise<void> {
  const appPath = join(pathToVault, ".obsidian", "app.json");
  const appConfig = {
    attachmentFolderPath: "Attachments",
    newFileLocation: "folder",
    newFileFolderPath: mode === "notes" ? "Notes" : "",
  };

  await writeJsonFile(appPath, appConfig);
}

export async function configureCoreSync(pathToVault: string, method: SyncMethod): Promise<void> {
  const corePluginsPath = join(pathToVault, ".obsidian", "core-plugins.json");
  const plugins = await readJsonFile<CorePlugins>(corePluginsPath);
  plugins.sync = method === "obsidian-sync";
  await writeJsonFile(corePluginsPath, plugins);
}

interface CommunityPluginOptions {
  enabled: boolean;
  includeGit: boolean;
  includeMinimalThemeTools: boolean;
}

function buildCommunityPlugins(options: CommunityPluginOptions): string[] {
  const plugins: string[] = ["templater-obsidian", "obsidian-linter"];

  if (options.includeGit) {
    plugins.push("obsidian-git");
  }

  if (options.includeMinimalThemeTools) {
    plugins.push("obsidian-minimal-settings", "obsidian-hider");
  }

  return plugins;
}

async function writeMinimalPluginConfigs(pathToVault: string): Promise<void> {
  const minimalSettingsPath = join(
    pathToVault,
    ".obsidian",
    "plugins",
    "obsidian-minimal-settings",
    "data.json",
  );

  const hiderPath = join(pathToVault, ".obsidian", "plugins", "obsidian-hider", "data.json");

  await writeJsonFile(minimalSettingsPath, {
    lightStyle: "minimal-light",
    darkStyle: "minimal-dark",
    colorfulHeadings: true,
    colorfulFrame: false,
    trimFileName: true,
    focusMode: false,
    underlineInternal: true,
    underlineExternal: true,
    fullWidthMedia: true,
  });

  await writeJsonFile(hiderPath, {
    hideVaultName: false,
    hideScrollbar: false,
    hideTitleBar: false,
    hideStatusBar: false,
    hideTabHeader: false,
    hideSearchSuggestions: false,
    hidePropertiesReading: true,
  });
}

export async function configureCommunityPlugins(
  pathToVault: string,
  options: CommunityPluginOptions,
): Promise<void> {
  const communityPath = join(pathToVault, ".obsidian", "community-plugins.json");
  const pluginFolderPath = join(pathToVault, ".obsidian", "plugins");

  if (!options.enabled) {
    await removePathIfExists(communityPath);
    await removePathIfExists(pluginFolderPath);
    return;
  }

  const plugins = buildCommunityPlugins(options);
  await writeJsonFile(communityPath, plugins);

  if (options.includeMinimalThemeTools) {
    await writeMinimalPluginConfigs(pathToVault);
  } else {
    await removePathIfExists(join(pluginFolderPath, "obsidian-minimal-settings"));
    await removePathIfExists(join(pluginFolderPath, "obsidian-hider"));
  }
}

function stripTemplaterSyntax(content: string): string {
  return content
    .replace(/^created:\s*<%\s*tp\.date\.now\("YYYY-MM-DD"\)\s*%>\s*$/gm, 'created: ""')
    .replace(/^updated:\s*<%\s*tp\.date\.now\("YYYY-MM-DD"\)\s*%>\s*$/gm, 'updated: ""');
}

export async function configureTemplatesForCommunity(pathToVault: string, enabled: boolean): Promise<void> {
  if (enabled) {
    return;
  }

  for (const templateFile of TEMPLATE_FILES) {
    const templatePath = join(pathToVault, "Templates", templateFile);
    const existing = await readFile(templatePath, "utf8");
    const next = stripTemplaterSyntax(existing);
    await writeFile(templatePath, next, "utf8");
  }
}

export async function configureMinimalTheme(pathToVault: string, enabled: boolean): Promise<void> {
  const appearancePath = join(pathToVault, ".obsidian", "appearance.json");
  const themePath = join(pathToVault, ".obsidian", "themes", "Minimal");

  if (!enabled) {
    await removePathIfExists(appearancePath);
    await removePathIfExists(themePath);
    return;
  }

  await writeJsonFile(appearancePath, {
    cssTheme: "Minimal",
  });

  await mkdir(themePath, { recursive: true });
  await writeJsonFile(join(themePath, "manifest.json"), {
    name: "Minimal",
    version: "7.7.2",
    minAppVersion: "1.0.0",
    author: "kepano",
    authorUrl: "https://github.com/kepano",
  });

  await writeFile(
    join(themePath, "theme.css"),
    [
      "/* Placeholder so Obsidian can resolve the Minimal theme folder during setup. */",
      "body {",
      "  --h1-weight: 600;",
      "  --h2-weight: 600;",
      "  --h3-weight: 600;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}
