export interface VaultFolders {
  inbox: string
  notes: string
  journal: string
  templates: string
  attachments: string
}

export interface VaultFoldersWithAgent extends VaultFolders {
  agent: string
}

export const FOLDERS_WITH_AGENT: VaultFoldersWithAgent = {
  inbox: "00 Inbox",
  notes: "01 Notes",
  journal: "03 Journal",
  agent: "02 Agent",
  templates: "04 Templates",
  attachments: "05 Attachments",
}

export const FOLDERS_WITHOUT_AGENT: VaultFolders = {
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

export const LEGACY_AGENT_FOLDER = "Agent"

export const NOTES_FOLDER_CANDIDATES = [FOLDERS_WITH_AGENT.notes, LEGACY_FOLDERS.notes] as const

export const JOURNAL_FOLDER_ALIASES = [
  FOLDERS_WITH_AGENT.journal,
  FOLDERS_WITHOUT_AGENT.journal,
  "02 Daily",
  "03 Daily",
  LEGACY_FOLDERS.journal,
  "Journal",
] as const

export const AGENT_FOLDER_ALIASES = [FOLDERS_WITH_AGENT.agent, "03 Agent", LEGACY_AGENT_FOLDER] as const

export function getVaultFolders(includeAgent: boolean): VaultFolders {
  return includeAgent ? FOLDERS_WITH_AGENT : FOLDERS_WITHOUT_AGENT
}
