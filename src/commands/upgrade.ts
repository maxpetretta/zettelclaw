import { cancel, intro, isCancel, log, outro, text } from "@clack/prompts";

import { resolveUserPath } from "../lib/paths";
import { copyVaultTemplatesOnly, isDirectory, pathExists } from "../lib/vault";

export interface UpgradeOptions {
  yes: boolean;
  vaultPath?: string;
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

  const result = await copyVaultTemplatesOnly(vaultPath, false);

  log.info(`Added ${result.added.length} template file(s).`);
  log.info(`Skipped ${result.skipped.length} existing template file(s).`);
  outro("Upgrade complete. Existing custom templates were preserved.");
}
