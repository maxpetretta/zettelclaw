import {
  access,
  copyFile,
  lstat,
  mkdir,
  rename,
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
  includeAgent: boolean;
}

interface CorePlugins {
  [pluginId: string]: boolean;
}

export interface VaultFolders {
  inbox: string;
  notes: string;
  journal: string;
  agent: string;
  templates: string;
  attachments: string;
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

const FOLDERS_WITH_AGENT: VaultFolders = {
  inbox: "00 Inbox",
  notes: "01 Notes",
  journal: "03 Journal",
  agent: "02 Agent",
  templates: "04 Templates",
  attachments: "05 Attachments",
};

const FOLDERS_WITHOUT_AGENT: VaultFolders = {
  inbox: "00 Inbox",
  notes: "01 Notes",
  journal: "02 Journal",
  agent: "02 Agent",
  templates: "03 Templates",
  attachments: "04 Attachments",
};

const LEGACY_FOLDERS: VaultFolders = {
  inbox: "Inbox",
  notes: "Notes",
  journal: "Daily",
  agent: "Agent",
  templates: "Templates",
  attachments: "Attachments",
};

const TEMPLATE_PATH_PREFIX = /^(?:\d{2} )?Templates\//;
const JOURNAL_FOLDER_ALIASES: readonly string[] = [
  FOLDERS_WITH_AGENT.journal,
  FOLDERS_WITHOUT_AGENT.journal,
  "02 Daily",
  "03 Daily",
  "Daily",
  "Journal",
] as const;
const AGENT_FOLDER_ALIASES: readonly string[] = [
  FOLDERS_WITH_AGENT.agent,
  "03 Agent",
  LEGACY_FOLDERS.agent,
] as const;

export function getVaultFolders(includeAgent: boolean): VaultFolders {
  return includeAgent ? FOLDERS_WITH_AGENT : FOLDERS_WITHOUT_AGENT;
}

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

function pathIsInsideFolder(relativePath: string, folder: string): boolean {
  return relativePath === folder || relativePath.startsWith(`${folder}/`);
}

function remapSeedPath(relativePath: string, options: CopyVaultOptions): string | null {
  let mapped = relativePath;

  if (options.mode === "root" && pathIsInsideFolder(mapped, FOLDERS_WITH_AGENT.notes)) {
    return null;
  }

  if (!options.includeAgent) {
    if (pathIsInsideFolder(mapped, FOLDERS_WITH_AGENT.agent)) {
      return null;
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.journal}/`)) {
      mapped = mapped.replace(
        `${FOLDERS_WITH_AGENT.journal}/`,
        `${FOLDERS_WITHOUT_AGENT.journal}/`,
      );
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.templates}/`)) {
      mapped = mapped.replace(
        `${FOLDERS_WITH_AGENT.templates}/`,
        `${FOLDERS_WITHOUT_AGENT.templates}/`,
      );
    }

    if (mapped.startsWith(`${FOLDERS_WITH_AGENT.attachments}/`)) {
      mapped = mapped.replace(
        `${FOLDERS_WITH_AGENT.attachments}/`,
        `${FOLDERS_WITHOUT_AGENT.attachments}/`,
      );
    }
  }

  return mapped;
}

async function detectTemplatesFolderName(vaultPath: string): Promise<string> {
  for (const folder of [
    FOLDERS_WITH_AGENT.templates,
    FOLDERS_WITHOUT_AGENT.templates,
    LEGACY_FOLDERS.templates,
  ]) {
    if (await pathExists(join(vaultPath, folder))) {
      return folder;
    }
  }

  return FOLDERS_WITH_AGENT.templates;
}

async function moveFolderIfPossible(
  vaultPath: string,
  sourceFolder: string,
  destinationFolder: string,
): Promise<void> {
  const sourcePath = join(vaultPath, sourceFolder);
  const destinationPath = join(vaultPath, destinationFolder);

  if (!(await pathExists(sourcePath))) {
    return;
  }

  if (await pathExists(destinationPath)) {
    return;
  }

  await rename(sourcePath, destinationPath);
}

async function moveFirstAliasToCanonical(
  vaultPath: string,
  canonicalFolder: string,
  aliasFolders: readonly string[],
): Promise<void> {
  const canonicalPath = join(vaultPath, canonicalFolder);

  if (await pathExists(canonicalPath)) {
    return;
  }

  for (const alias of aliasFolders) {
    if (alias === canonicalFolder) {
      continue;
    }

    const aliasPath = join(vaultPath, alias);
    if (await pathExists(aliasPath)) {
      await rename(aliasPath, canonicalPath);
      return;
    }
  }
}

export async function copyVaultSeed(vaultPath: string, options: CopyVaultOptions): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true });

  const files = await walkFiles(TEMPLATE_ROOT);
  const result: CopyResult = {
    added: [],
    skipped: [],
  };

  for (const relativePath of files) {
    const mappedRelativePath = remapSeedPath(relativePath, options);

    if (!mappedRelativePath) {
      continue;
    }

    const source = join(TEMPLATE_ROOT, relativePath);
    const destination = join(vaultPath, mappedRelativePath);

    await mkdir(dirname(destination), { recursive: true });

    const exists = await pathExists(destination);

    if (exists && !options.overwrite) {
      result.skipped.push(mappedRelativePath);
      continue;
    }

    await copyFile(source, destination);
    result.added.push(mappedRelativePath);
  }

  return result;
}

export async function copyVaultTemplatesOnly(vaultPath: string, overwrite: boolean): Promise<CopyResult> {
  await mkdir(vaultPath, { recursive: true });

  const sourceTemplatesFolder = FOLDERS_WITH_AGENT.templates;
  const destinationTemplatesFolder = await detectTemplatesFolderName(vaultPath);
  const templateFiles = await walkFiles(join(TEMPLATE_ROOT, sourceTemplatesFolder));
  const result: CopyResult = {
    added: [],
    skipped: [],
  };

  for (const relativePath of templateFiles) {
    const source = join(TEMPLATE_ROOT, sourceTemplatesFolder, relativePath);
    const destination = join(vaultPath, destinationTemplatesFolder, relativePath);

    await mkdir(dirname(destination), { recursive: true });

    const exists = await pathExists(destination);

    if (exists && !overwrite) {
      result.skipped.push(join(destinationTemplatesFolder, relativePath));
      continue;
    }

    await copyFile(source, destination);
    result.added.push(join(destinationTemplatesFolder, relativePath));
  }

  return result;
}

export async function detectNotesMode(vaultPath: string): Promise<NotesMode> {
  if (await pathExists(join(vaultPath, FOLDERS_WITH_AGENT.notes))) {
    return "notes";
  }

  if (await pathExists(join(vaultPath, LEGACY_FOLDERS.notes))) {
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
  const agentFolder = FOLDERS_WITH_AGENT.agent;
  const agentDir = join(vaultPath, agentFolder);
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
          result.skipped.push(`${agentFolder}/${file}`);
          continue;
        }
      }

      result.skipped.push(`${agentFolder}/${file}`);
      continue;
    }

    await symlink(targetPath, linkPath);
    result.added.push(`${agentFolder}/${file}`);
  }

  // Once real symlinks are present, the placeholder keeper is unnecessary.
  await removePathIfExists(join(agentDir, ".gitkeep"));

  return result;
}

export async function configureAgentFolder(vaultPath: string, enabled: boolean): Promise<void> {
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.inbox, FOLDERS_WITH_AGENT.inbox);
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.notes, FOLDERS_WITH_AGENT.notes);

  if (enabled) {
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.journal, JOURNAL_FOLDER_ALIASES);
    await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITH_AGENT.agent, AGENT_FOLDER_ALIASES);
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITH_AGENT.templates);
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.templates, FOLDERS_WITH_AGENT.templates);
    await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITH_AGENT.attachments);
    await moveFolderIfPossible(vaultPath, FOLDERS_WITHOUT_AGENT.attachments, FOLDERS_WITH_AGENT.attachments);
    await mkdir(join(vaultPath, FOLDERS_WITH_AGENT.agent), { recursive: true });
    return;
  }

  for (const agentFolder of AGENT_FOLDER_ALIASES) {
    await removePathIfExists(join(vaultPath, agentFolder));
  }

  await moveFirstAliasToCanonical(vaultPath, FOLDERS_WITHOUT_AGENT.journal, JOURNAL_FOLDER_ALIASES);
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.templates, FOLDERS_WITHOUT_AGENT.templates);
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.templates, FOLDERS_WITHOUT_AGENT.templates);
  await moveFolderIfPossible(vaultPath, LEGACY_FOLDERS.attachments, FOLDERS_WITHOUT_AGENT.attachments);
  await moveFolderIfPossible(vaultPath, FOLDERS_WITH_AGENT.attachments, FOLDERS_WITHOUT_AGENT.attachments);
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonFileOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile<T>(path);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rewriteTemplatePaths(value: unknown, templatesFolder: string): unknown {
  if (typeof value === "string") {
    return value.replace(TEMPLATE_PATH_PREFIX, `${templatesFolder}/`);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => rewriteTemplatePaths(entry, templatesFolder));
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = rewriteTemplatePaths(nested, templatesFolder);
    }

    return next;
  }

  return value;
}

export async function configureApp(
  pathToVault: string,
  mode: NotesMode,
  includeAgent: boolean,
): Promise<void> {
  const folders = getVaultFolders(includeAgent);
  const journalTemplatePath = `${folders.templates}/daily.md`;

  const appPath = join(pathToVault, ".obsidian", "app.json");
  const appConfig = {
    attachmentFolderPath: folders.attachments,
    newFileLocation: "folder",
    newFileFolderPath: mode === "notes" ? folders.notes : "",
  };

  await writeJsonFile(appPath, appConfig);

  const dailyNotesPath = join(pathToVault, ".obsidian", "daily-notes.json");
  const dailyNotesConfig = await readJsonFileOrDefault<Record<string, unknown>>(dailyNotesPath, {});
  dailyNotesConfig.folder = folders.journal;
  dailyNotesConfig.template = journalTemplatePath;

  if (typeof dailyNotesConfig.format !== "string") {
    dailyNotesConfig.format = "YYYY-MM-DD";
  }

  await writeJsonFile(dailyNotesPath, dailyNotesConfig);

  const templatesPath = join(pathToVault, ".obsidian", "templates.json");
  const templatesConfig = await readJsonFileOrDefault<Record<string, unknown>>(templatesPath, {});
  templatesConfig.folder = folders.templates;
  await writeJsonFile(templatesPath, templatesConfig);

  const templaterPath = join(pathToVault, ".obsidian", "plugins", "templater-obsidian", "data.json");

  if (await pathExists(templaterPath)) {
    const templaterConfig = await readJsonFileOrDefault<Record<string, unknown>>(templaterPath, {});
    templaterConfig.templates_folder = folders.templates;
    templaterConfig.trigger_on_file_creation = true;
    templaterConfig.enable_folder_templates = true;

    const rawRules = Array.isArray(templaterConfig.folder_templates)
      ? templaterConfig.folder_templates
      : [];
    const normalizedRules: unknown[] = [];
    let journalRuleSet = false;

    for (const rule of rawRules) {
      if (!rule || typeof rule !== "object") {
        normalizedRules.push(rule);
        continue;
      }

      const nextRule = { ...(rule as Record<string, unknown>) };
      const ruleFolder = typeof nextRule.folder === "string" ? nextRule.folder : "";
      const ruleTemplate = typeof nextRule.template === "string" ? nextRule.template : "";
      const isJournalRule =
        ruleTemplate.endsWith("/daily.md") ||
        JOURNAL_FOLDER_ALIASES.includes(ruleFolder);

      if (isJournalRule) {
        nextRule.folder = folders.journal;
        nextRule.template = journalTemplatePath;
        journalRuleSet = true;
      }

      normalizedRules.push(nextRule);
    }

    if (!journalRuleSet) {
      normalizedRules.push({
        folder: folders.journal,
        template: journalTemplatePath,
      });
    }

    templaterConfig.folder_templates = normalizedRules;
    await writeJsonFile(templaterPath, templaterConfig);
  }

  const workspacePath = join(pathToVault, ".obsidian", "workspace.json");

  if (await pathExists(workspacePath)) {
    const workspace = await readJsonFileOrDefault<unknown>(workspacePath, {});
    const nextWorkspace = rewriteTemplatePaths(workspace, folders.templates);
    await writeJsonFile(workspacePath, nextWorkspace);
  }
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

  const templatesFolder = await detectTemplatesFolderName(pathToVault);

  for (const templateFile of TEMPLATE_FILES) {
    const templatePath = join(pathToVault, templatesFolder, templateFile);
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

  // Theme files (manifest.json + theme.css) are downloaded by plugins.ts
  // Just ensure the directory exists
  await mkdir(themePath, { recursive: true });
}
