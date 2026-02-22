import { mock } from "bun:test"

interface MockSpawnSyncResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error & { code?: string }
}

function defaultSpawnSyncResult(): MockSpawnSyncResult {
  return {
    status: 0,
    stdout: "",
    stderr: "",
  }
}

function defaultSpawnSync(_command: string, _args?: string[], _options?: Record<string, unknown>): MockSpawnSyncResult {
  return defaultSpawnSyncResult()
}

export const spawnSyncMock = mock(defaultSpawnSync)

export function resetSpawnSyncMock(): void {
  spawnSyncMock.mockReset()
  spawnSyncMock.mockImplementation(defaultSpawnSync)
}

resetSpawnSyncMock()

mock.module("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}))
