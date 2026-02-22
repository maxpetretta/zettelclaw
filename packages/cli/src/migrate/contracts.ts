export type MigrateTaskKind = "daily" | "other"

export interface MigrateTask {
  id: string
  relativePath: string
  basename: string
  sourcePath: string
  kind: MigrateTaskKind
}

export interface MigrateSubagentExtraction {
  sourceFile: string
  status: "ok" | "error"
  summary: string
  createdWikilinks: string[]
  createdNotes: string[]
  updatedNotes: string[]
  journalDaysTouched: string[]
  deletedSource: boolean
}

export interface StoredMigrateTaskResult {
  taskId: string
  relativePath: string
  extraction: MigrateSubagentExtraction
  completedAt: string
}

export interface MigrateRunState {
  version: 1
  runKey: string
  workspacePath: string
  vaultPath: string
  model: string
  createdAt: string
  updatedAt: string
  completed: Record<string, StoredMigrateTaskResult>
  finalSynthesisCompleted: boolean
  finalSynthesisSummary?: string | undefined
  cleanupCompleted: boolean
}

export interface MigratePipelineOptions {
  workspacePath: string
  memoryPath: string
  vaultPath: string
  notesFolder: string
  journalFolder: string
  model: string
  statePath: string
  tasks: MigrateTask[]
  parallelJobs?: number
  onProgress?: (message: string) => void
}

export interface MigratePipelineResult {
  totalTasks: number
  processedTasks: number
  skippedTasks: number
  failedTasks: number
  failedTaskErrors: string[]
  finalSynthesisSummary: string
  statePath: string
  cleanupCompleted: boolean
  completedResults: StoredMigrateTaskResult[]
}
