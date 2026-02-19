import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { appendWorkspaceIntegration, gatewayPatchSnippet } from "../lib/openclaw";
import { resolveUserPath } from "../lib/paths";
import {
  configureAgentFolder,
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  configureTemplatesForCommunity,
  copyVaultSeed,
  createAgentSymlinks,
  directoryHasEntries,
  isDirectory,
  pathExists,
  type NotesMode,
  type SyncMethod,
} from "../lib/vault";

export interface InitOptions {
  openclaw: boolean;
  yes: boolean;
  vaultPath?: string;
  mode?: NotesMode;
  createSymlinks?: boolean;
  workspacePath?: string;
  initGit?: boolean;
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  return value as T;
}

async function promptVaultPath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "Vault path",
      placeholder: defaultPath,
      defaultValue: defaultPath,
    }),
  );
}

async function promptMode(defaultMode: NotesMode): Promise<NotesMode> {
  return unwrapPrompt(
    await select({
      message: "Note location",
      initialValue: defaultMode,
      options: [
        {
          value: "notes",
          label: "Notes/ folder (recommended)",
          hint: "Default",
        },
        {
          value: "root",
          label: "Vault root (Steph Ango style)",
        },
      ],
    }),
  ) as NotesMode;
}

async function promptCommunityPlugins(defaultValue: boolean): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message: "Install recommended community plugins? (Templater, Linter, Obsidian Git)",
      initialValue: defaultValue,
    }),
  );
}

async function promptSyncMethod(defaultMethod: SyncMethod): Promise<SyncMethod> {
  return unwrapPrompt(
    await select({
      message: "How do you want to sync your vault?",
      initialValue: defaultMethod,
      options: [
        {
          value: "git",
          label: "Git (via Obsidian Git plugin) (recommended)",
        },
        {
          value: "obsidian-sync",
          label: "Obsidian Sync",
        },
        {
          value: "none",
          label: "None",
        },
      ],
    }),
  ) as SyncMethod;
}

async function promptAgentSymlinks(defaultValue: boolean): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message: "Create Agent/ folder with symlinks to OpenClaw workspace? (recommended)",
      initialValue: defaultValue,
    }),
  );
}

async function promptWorkspacePath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "OpenClaw workspace path",
      placeholder: defaultPath,
      defaultValue: defaultPath,
    }),
  );
}

async function promptMinimalTheme(defaultValue: boolean): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message: "Install Minimal theme with recommended settings?",
      initialValue: defaultValue,
    }),
  );
}

async function promptGitInit(defaultValue: boolean): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message: "Initialize a git repository?",
      initialValue: defaultValue,
    }),
  );
}

async function promptOpenClawIntegration(defaultValue: boolean): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message: "Append Zettelclaw instructions to OpenClaw workspace files? (recommended for OpenClaw users)",
      initialValue: defaultValue,
    }),
  );
}

function normalizeMode(input: string | undefined): NotesMode | undefined {
  if (!input) {
    return undefined;
  }

  return input === "root" ? "root" : "notes";
}

export async function runInit(options: InitOptions): Promise<void> {
  intro("Zettelclaw init");

  const defaults = {
    vaultPath: process.cwd(),
    mode: normalizeMode(options.mode) ?? "notes",
    useCommunityPlugins: true,
    syncMethod: "git" as SyncMethod,
    createSymlinks: options.createSymlinks ?? true,
    workspacePath: options.workspacePath ?? "~/.openclaw/workspace",
    minimalTheme: false,
    initGit: options.initGit ?? true,
    openclawIntegration: options.openclaw,
  };

  const rawVaultPath =
    options.vaultPath ?? (options.yes ? defaults.vaultPath : await promptVaultPath(defaults.vaultPath));
  const vaultPath = resolveUserPath(rawVaultPath);

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`);
    }

    const hasEntries = await directoryHasEntries(vaultPath);
    if (hasEntries && !options.yes) {
      const shouldContinue = unwrapPrompt(
        await confirm({
          message: "Vault path is not empty. Continue without overwriting existing files?",
          initialValue: false,
        }),
      );

      if (!shouldContinue) {
        cancel("Cancelled.");
        process.exit(0);
      }
    }
  }

  const mode = options.mode ?? (options.yes ? defaults.mode : await promptMode(defaults.mode));

  const useCommunityPlugins = options.yes
    ? defaults.useCommunityPlugins
    : await promptCommunityPlugins(defaults.useCommunityPlugins);

  const syncMethod = useCommunityPlugins
    ? options.yes
      ? defaults.syncMethod
      : await promptSyncMethod(defaults.syncMethod)
    : "none";

  const createSymlinks =
    options.createSymlinks ??
    (options.yes ? defaults.createSymlinks : await promptAgentSymlinks(defaults.createSymlinks));

  let workspacePath: string | undefined;

  if (createSymlinks) {
    const rawWorkspacePath = options.yes
      ? defaults.workspacePath
      : await promptWorkspacePath(defaults.workspacePath);
    workspacePath = resolveUserPath(rawWorkspacePath);
  }

  const minimalTheme = options.yes ? defaults.minimalTheme : await promptMinimalTheme(defaults.minimalTheme);

  if (minimalTheme && !useCommunityPlugins) {
    log.warn(
      "Community plugins are disabled. Minimal theme will be configured, but minimal-settings and hider plugins will not be installed.",
    );
  }

  const initGit = options.initGit ?? (options.yes ? defaults.initGit : await promptGitInit(defaults.initGit));

  const openclawIntegration = options.yes
    ? defaults.openclawIntegration
    : await promptOpenClawIntegration(defaults.openclawIntegration);

  if (openclawIntegration && !workspacePath) {
    const rawWorkspacePath = options.yes
      ? defaults.workspacePath
      : await promptWorkspacePath(defaults.workspacePath);
    workspacePath = resolveUserPath(rawWorkspacePath);
  }

  const s = spinner();
  s.start("Copying vault template and applying setup choices");

  const templateResult = await copyVaultSeed(vaultPath, { mode, overwrite: false });

  await configureApp(vaultPath, mode);
  await configureCoreSync(vaultPath, syncMethod);
  await configureCommunityPlugins(vaultPath, {
    enabled: useCommunityPlugins,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: useCommunityPlugins && minimalTheme,
  });
  await configureTemplatesForCommunity(vaultPath, useCommunityPlugins);
  await configureMinimalTheme(vaultPath, minimalTheme);

  if (createSymlinks && workspacePath) {
    const symlinkResult = await createAgentSymlinks(vaultPath, workspacePath);
    log.info(`Agent symlinks: created ${symlinkResult.added.length}, skipped ${symlinkResult.skipped.length}.`);
  } else {
    await configureAgentFolder(vaultPath, false);
  }

  s.stop(`Vault ready at ${vaultPath}`);
  log.info(`Added ${templateResult.added.length} file(s), skipped ${templateResult.skipped.length}.`);

  if (initGit) {
    const gitDir = join(vaultPath, ".git");

    if (await pathExists(gitDir)) {
      log.info("Git repo already exists; skipping init.");
    } else {
      const result = spawnSync("git", ["init"], {
        cwd: vaultPath,
        encoding: "utf8",
      });

      if (result.status === 0) {
        log.success("Initialized git repository.");
      } else {
        log.warn(`Failed to run git init: ${result.stderr?.trim() || "unknown error"}`);
      }
    }
  }

  if (openclawIntegration) {
    if (!workspacePath) {
      throw new Error("Workspace path is required when OpenClaw integration is enabled.");
    }

    const integration = await appendWorkspaceIntegration(workspacePath, {
      vaultPath,
      notesMode: mode,
      symlinksEnabled: createSymlinks,
    });

    log.info(
      `Workspace updates: appended ${integration.added.length} section(s), skipped ${integration.skipped.length}.`,
    );

    note(
      gatewayPatchSnippet(vaultPath),
      "Manual OpenClaw gateway patch (described only, not automatically applied)",
    );
  }

  outro("Done. Use `bun run src/index.ts upgrade` later to add new defaults without overwriting edits.");
}
