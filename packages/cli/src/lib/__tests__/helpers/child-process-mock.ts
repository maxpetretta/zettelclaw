import { mock } from "bun:test"

function defaultSpawnSyncResult() {
  return {
    status: 0,
    stdout: "",
    stderr: "",
  }
}

export const spawnSyncMock = mock(defaultSpawnSyncResult)

export function resetSpawnSyncMock(): void {
  spawnSyncMock.mockReset()
  spawnSyncMock.mockImplementation(defaultSpawnSyncResult)
}

resetSpawnSyncMock()

mock.module("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}))
