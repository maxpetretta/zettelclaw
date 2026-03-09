import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["run", "src/index.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  })

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

describe("CLI entrypoint", () => {
  test("prints help output", () => {
    const result = runCli(["help"])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("zettelclaw init [options]")
    expect(result.stdout).toContain("--theme <preset>")
    expect(result.stdout).not.toContain("zettelclaw plugins")
  })

  test("rejects verify-only unsupported flags", () => {
    const themeResult = runCli(["verify", "--theme", "minimal"])
    expect(themeResult.status).toBe(1)
    expect(`${themeResult.stdout}${themeResult.stderr}`).toContain("--theme is only supported with `zettelclaw init`")

    const syncResult = runCli(["verify", "--sync", "git"])
    expect(syncResult.status).toBe(1)
    expect(`${syncResult.stdout}${syncResult.stderr}`).toContain("--sync is only supported with `zettelclaw init`")
  })

  test("rejects unknown commands", () => {
    const result = runCli(["plugins"])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown command: plugins")
  })

  test("rejects extra positional arguments", () => {
    const result = runCli(["init", "extra"])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown argument: extra")
  })

  test("rejects empty string option values", () => {
    const vaultResult = runCli(["init", "--vault="])
    expect(vaultResult.status).toBe(1)
    expect(`${vaultResult.stdout}${vaultResult.stderr}`).toContain("Missing value for --vault")

    const workspaceResult = runCli(["verify", "--workspace="])
    expect(workspaceResult.status).toBe(1)
    expect(`${workspaceResult.stdout}${workspaceResult.stderr}`).toContain("Missing value for --workspace")
  })
})
