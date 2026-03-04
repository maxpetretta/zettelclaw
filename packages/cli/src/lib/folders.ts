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

export const LEGACY_FOLDERS: VaultFolders = {
  inbox: "Inbox",
  notes: "Notes",
  journal: "Daily",
  templates: "Templates",
  attachments: "Attachments",
}

export const LEGACY_AGENT_FOLDER_ALIASES = ["02 Agent", "03 Agent", "Agent"] as const

export const NOTES_FOLDER_CANDIDATES = [FOLDERS.notes, LEGACY_FOLDERS.notes] as const

export const JOURNAL_FOLDER_ALIASES = [
  FOLDERS.journal,
  "03 Journal",
  "02 Daily",
  "03 Daily",
  LEGACY_FOLDERS.journal,
  "Journal",
] as const

export const TEMPLATES_FOLDER_ALIASES = [FOLDERS.templates, "04 Templates", LEGACY_FOLDERS.templates] as const

export const ATTACHMENTS_FOLDER_ALIASES = [FOLDERS.attachments, "05 Attachments", LEGACY_FOLDERS.attachments] as const

export function getVaultFolders(): VaultFolders {
  return FOLDERS
}
