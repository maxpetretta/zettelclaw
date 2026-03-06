import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { FOLDERS } from "./folders"

export async function configureVaultFolders(vaultPath: string): Promise<void> {
  for (const folder of Object.values(FOLDERS)) {
    await mkdir(join(vaultPath, folder), { recursive: true })
  }
}
