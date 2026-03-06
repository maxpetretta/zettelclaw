export interface VaultFolders {
  inbox: string
  notes: string
  journal: string
  templates: string
  attachments: string
}

export const FOLDERS: VaultFolders = {
  inbox: "00 Inbox",
  notes: "01 Notes",
  journal: "02 Journal",
  templates: "03 Templates",
  attachments: "04 Attachments",
}

export function getVaultFolders(): VaultFolders {
  return FOLDERS
}
