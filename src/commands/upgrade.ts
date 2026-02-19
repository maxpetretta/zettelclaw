import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts";

import { resolveUserPath } from "../lib/paths";
import { applyVaultTemplate, detectNotesMode, isDirectory, pathExists, type NotesMode } from "../lib/vault";

export interface UpgradeOptions {
  yes: boolean;
  vaultPath?: string;
  mode?: NotesMode;
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
      message: "Detected note layout",
      initialValue: defaultMode,
      options: [
        { value: "notes", label: "Notes mode" },
        { value: "root", label: "Root mode" },
      ],
    }),
  ) as NotesMode;
}

export async function runUpgrade(options: UpgradeOptions): Promise<void> {
  intro("Zettelclaw upgrade");

  const rawVaultPath =
    options.vaultPath ?? (options.yes ? process.cwd() : await promptVaultPath(process.cwd()));
  const vaultPath = resolveUserPath(rawVaultPath);

  if (await pathExists(vaultPath)) {
    if (!(await isDirectory(vaultPath))) {
      throw new Error(`Vault path is not a directory: ${vaultPath}`);
    }
  }

  const detectedMode = options.mode ?? (await detectNotesMode(vaultPath));
  const mode = options.yes ? detectedMode : await promptMode(detectedMode);

  const result = await applyVaultTemplate(vaultPath, {
    mode,
    overwrite: false,
  });

  log.info(`Added ${result.added.length} file(s).`);
  log.info(`Skipped ${result.skipped.length} existing file(s).`);
  outro("Upgrade complete. Existing custom files were preserved.");
}
