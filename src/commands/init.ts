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
  applyVaultTemplate,
  createAgentSymlinks,
  directoryHasEntries,
  isDirectory,
  pathExists,
  type NotesMode,
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
      message: "Choose note layout",
      initialValue: defaultMode,
      options: [
        {
          value: "notes",
          label: "Notes mode (recommended)",
          hint: "All notes live in Notes/",
        },
        {
          value: "root",
          label: "Root mode",
          hint: "Notes live in the vault root",
        },
      ],
    }),
  ) as NotesMode;
}

async function promptBoolean(message: string, defaultValue = false): Promise<boolean> {
  return unwrapPrompt(
    await confirm({
      message,
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

function normalizeMode(input: string | undefined): NotesMode | undefined {
  if (!input) {
    return undefined;
  }

  return input === "root" ? "root" : "notes";
}

export async function runInit(options: InitOptions): Promise<void> {
  intro(`Zettelclaw init${options.openclaw ? " --openclaw" : ""}`);

  const defaults = {
    vaultPath: process.cwd(),
    mode: normalizeMode(options.mode) ?? "notes",
    workspacePath: "~/.openclaw/workspace",
    createSymlinks: options.createSymlinks ?? false,
    initGit: options.initGit ?? false,
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
      const shouldContinue = await promptBoolean(
        "Vault path is not empty. Continue without overwriting existing files?",
        false,
      );
      if (!shouldContinue) {
        cancel("Cancelled.");
        process.exit(0);
      }
    }
  }

  const mode = options.mode ?? (options.yes ? defaults.mode : await promptMode(defaults.mode));

  const createSymlinks =
    options.createSymlinks ??
    (options.yes ? defaults.createSymlinks : await promptBoolean("Create Agent/ symlinks?", false));

  const needsWorkspace = options.openclaw || createSymlinks;
  const rawWorkspacePath =
    options.workspacePath ??
    (needsWorkspace
      ? options.yes
        ? defaults.workspacePath
        : await promptWorkspacePath(defaults.workspacePath)
      : undefined);
  const workspacePath = rawWorkspacePath ? resolveUserPath(rawWorkspacePath) : undefined;

  const initGit =
    options.initGit ?? (options.yes ? defaults.initGit : await promptBoolean("Initialize git repo?", false));

  const s = spinner();
  s.start("Applying vault template");
  const templateResult = await applyVaultTemplate(vaultPath, { mode, overwrite: false });
  s.stop(`Vault ready at ${vaultPath}`);

  log.info(`Added ${templateResult.added.length} template file(s), skipped ${templateResult.skipped.length}.`);

  if (createSymlinks && workspacePath) {
    const symlinkResult = await createAgentSymlinks(vaultPath, workspacePath);
    log.info(`Agent symlinks: created ${symlinkResult.added.length}, skipped ${symlinkResult.skipped.length}.`);
  }

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

  if (options.openclaw) {
    if (!workspacePath) {
      throw new Error("Workspace path is required for --openclaw.");
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

  outro(`Done. Use \`bun run src/index.ts upgrade\` later to add any new defaults without overwriting edits.`);
}
