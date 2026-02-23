import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeAgentSymlinks } from "../vault-agent"

const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true })
    }),
  )
})

describe("removeAgentSymlinks", () => {
  it("removes managed workspace symlinks and keeps unrelated entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "zettelclaw-vault-agent-remove-test-"))
    tempPaths.push(root)

    const vaultPath = join(root, "vault")
    const workspacePath = join(root, "workspace")
    const agentDir = join(vaultPath, "02 Agent")

    await mkdir(agentDir, { recursive: true })
    await mkdir(workspacePath, { recursive: true })

    const expectedTarget = join(workspacePath, "AGENTS.md")
    const foreignTarget = join(root, "foreign", "TOOLS.md")

    await mkdir(join(root, "foreign"), { recursive: true })
    await writeFile(expectedTarget, "workspace agents", "utf8")
    await writeFile(foreignTarget, "foreign tools", "utf8")
    await symlink(expectedTarget, join(agentDir, "AGENTS.md"))
    await symlink(foreignTarget, join(agentDir, "TOOLS.md"))
    await writeFile(join(agentDir, "MEMORY.md"), "plain file", "utf8")

    const result = await removeAgentSymlinks(vaultPath, workspacePath)

    expect(result.removed).toEqual(["02 Agent/AGENTS.md"])
    expect(result.skipped).toEqual(expect.arrayContaining(["02 Agent/TOOLS.md", "02 Agent/MEMORY.md"]))
    expect(result.failed).toEqual([])
  })
})
