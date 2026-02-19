import { intro, isCancel, select, spinner, text } from "@clack/prompts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { appendWorkspaceIntegration, patchOpenClawConfig } from "../lib/openclaw";
import { resolveUserPath } from "../lib/paths";
import { downloadPlugins } from "../lib/plugins";
import {
  configureAgentFolder,
  configureApp,
  configureCommunityPlugins,
  configureCoreSync,
  configureMinimalTheme,
  configureTemplatesForCommunity,
  copyVaultSeed,
  createAgentSymlinks,
  isDirectory,
  pathExists,
  type NotesMode,
  type SyncMethod,
} from "../lib/vault";

export interface InitOptions {
  openclaw: boolean;
  yes: boolean;
  vaultPath?: string;
  root: boolean;
  minimal: boolean;
  noOpenclaw: boolean;
  workspacePath?: string;
  initGit?: boolean;
}

function unwrapPrompt<T>(value: T | symbol): T {
  if (isCancel(value)) {
    process.exit(0);
  }

  return value as T;
}

async function promptVaultPath(defaultPath: string): Promise<string> {
  return unwrapPrompt(
    await text({
      message: "Where should the vault be created?",
      placeholder: defaultPath,
      defaultValue: defaultPath,
    }),
  );
}

async function promptSyncMethod(defaultMethod: SyncMethod): Promise<SyncMethod> {
  return unwrapPrompt(
    await select({
      message: "How do you want to sync your vault?",
      initialValue: defaultMethod,
      options: [
        { value: "git", label: "Git (recommended)" },
        { value: "obsidian-sync", label: "Obsidian Sync" },
        { value: "none", label: "None" },
      ],
    }),
  ) as SyncMethod;
}

function configuredPluginsSummary(syncMethod: SyncMethod): string {
  if (syncMethod === "git") {
    return "Templater, Linter, Obsidian Git";
  }

  if (syncMethod === "obsidian-sync") {
    return "Templater, Linter, Obsidian Sync";
  }

  return "Templater, Linter";
}

export async function runInit(options: InitOptions): Promise<void> {
  intro("Zettelclaw init");

  const defaultVaultPath = process.cwd();
  const rawVaultPath =
    options.vaultPath ?? (options.yes ? defaultVaultPath : await promptVaultPath(defaultVaultPath));
  const vaultPath = resolveUserPath(rawVaultPath);

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`);
    }
  }

  const syncMethod = options.yes ? "git" : await promptSyncMethod("git");
  const mode: NotesMode = options.root ? "root" : "notes";
  const workspacePath = resolveUserPath(options.workspacePath ?? "~/.openclaw/workspace");
  const workspaceDetected = !options.noOpenclaw && (await isDirectory(workspacePath));
  const shouldInitGit = options.initGit ?? true;

  const s = spinner();
  s.start("Configuring vault");

  await copyVaultSeed(vaultPath, { mode, overwrite: false });
  await configureApp(vaultPath, mode);
  await configureCoreSync(vaultPath, syncMethod);
  await configureCommunityPlugins(vaultPath, {
    enabled: true,
    includeGit: syncMethod === "git",
    includeMinimalThemeTools: options.minimal,
  });
  await configureTemplatesForCommunity(vaultPath, true);
  await configureMinimalTheme(vaultPath, options.minimal);

  s.message("Downloading plugins");
  const pluginResult = await downloadPlugins(vaultPath, {
    includeGit: syncMethod === "git",
    includeMinimal: options.minimal,
  });

  let symlinksCreated = false;
  let workspaceUpdated = false;
  let configPatched = false;

  if (workspaceDetected) {
    const symlinkResult = await createAgentSymlinks(vaultPath, workspacePath);
    symlinksCreated = symlinkResult.added.length > 0;

    const integration = await appendWorkspaceIntegration(workspacePath, {
      vaultPath,
      notesMode: mode,
      symlinksEnabled: symlinkResult.added.length > 0 || symlinkResult.skipped.length > 0,
    });

    workspaceUpdated = integration.added.length > 0;

    // Derive OpenClaw home from workspace path (workspace is always <openclaw_dir>/workspace)
    const openclawDir = join(workspacePath, "..");
    configPatched = await patchOpenClawConfig(vaultPath, openclawDir);
  } else {
    await configureAgentFolder(vaultPath, false);
  }

  let gitInitialized = false;

  if (shouldInitGit) {
    const gitDir = join(vaultPath, ".git");

    if (!(await pathExists(gitDir))) {
      const result = spawnSync("git", ["init"], {
        cwd: vaultPath,
        encoding: "utf8",
      });

      gitInitialized = result.status === 0;
    }
  }

  s.stop("Setup complete");

  console.log(`✓ Vault created at ${vaultPath}`);
  console.log("✓ Templates written (6 templates)");
  console.log(`✓ Obsidian configured (${configuredPluginsSummary(syncMethod)})`);

  if (pluginResult.downloaded.length > 0) {
    console.log(`✓ Plugins downloaded (${pluginResult.downloaded.join(", ")})`);
  }

  if (pluginResult.failed.length > 0) {
    console.log(`⚠ Failed to download: ${pluginResult.failed.join(", ")} — install manually from Obsidian`);
  }

  if (symlinksCreated) {
    console.log("✓ Agent/ symlinks created (OpenClaw workspace detected)");
  }

  if (workspaceUpdated) {
    console.log("✓ Workspace files updated (AGENTS.md, MEMORY.md, HEARTBEAT.md)");
  }

  if (gitInitialized) {
    console.log("✓ Git repository initialized");
  }

  if (options.minimal) {
    console.log("✓ Minimal theme installed");
  }

  if (configPatched) {
    console.log("✓ OpenClaw config patched (memorySearch.extraPaths)");
    console.log("\n⚠ Restart OpenClaw gateway for the config change to take effect.");
  }

  console.log("\nDone! Open it in Obsidian to get started.");
}
