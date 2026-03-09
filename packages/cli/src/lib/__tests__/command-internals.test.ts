import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

import { __testing as initTesting } from "../../commands/init"
import { __testing as verifyTesting } from "../../commands/verify"
import { expectedQmdCollections } from "../qmd"
import { withEnv, withTempDir, writeExecutable, writeJsonFile, writeTextFile } from "./test-helpers"

describe("command helper internals", () => {
  test("init helper functions derive qmd summaries", () => {
    const configured = expectedQmdCollections("/tmp/demo")
    const configuredNames = configured.map((collection) => collection.name)

    expect(
      initTesting.buildQmdCollectionSummary("/tmp/demo", [configuredNames[0] ?? "", configuredNames[2] ?? ""]),
    ).toBe("Inbox, Journal")
    expect(initTesting.buildQmdCollectionSummary("/tmp/demo", [])).toBeNull()
  })

  test("initGitRepository reports missing git and non-zero exits", async () => {
    await withTempDir("zettelclaw-init-git-helper-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const binDir = join(dir, "bin")
      await mkdir(vaultPath, { recursive: true })

      await withEnv({ PATH: join(dir, "missing-bin") }, () => {
        expect(initTesting.initGitRepository(vaultPath)).toContain("git")
      })

      await writeExecutable(
        join(binDir, "git"),
        `#!/bin/sh
echo "git failed" >&2
exit 2
`,
      )
      await withEnv({ PATH: binDir }, () => {
        expect(initTesting.initGitRepository(vaultPath)).toBe("git failed")
      })

      await writeExecutable(
        join(binDir, "git"),
        `#!/bin/sh
exit 3
`,
      )
      await withEnv({ PATH: binDir }, () => {
        expect(initTesting.initGitRepository(vaultPath)).toBe("git init exited with code 3")
      })
    })
  })

  test("verify helper functions normalize paths, parse records, and summarize output", () => {
    const tabsNode = verifyTesting.findTabsNode({
      type: "split",
      children: [{ type: "tabs", children: [] }],
    })

    expect(verifyTesting.hasLegacyTopLevelMemorySearch({ memorySearch: {} })).toBe(true)
    expect(verifyTesting.combineStatuses("pass", "warn")).toBe("warn")
    expect(verifyTesting.combineStatuses("warn", "fail")).toBe("fail")
    expect(verifyTesting.normalizePath("/tmp/demo///")).toBe("/tmp/demo")
    expect(verifyTesting.pathListIncludes(["/tmp/demo/"], "/tmp/demo")).toBe(true)
    expect(verifyTesting.parseJsonRecord('{"ok":true}')).toEqual({ ok: true })
    expect(verifyTesting.parseJsonRecord("[]")).toBeUndefined()
    expect(verifyTesting.parseJsonRecord(undefined)).toBeUndefined()
    expect(verifyTesting.summarizeQmdIssue(undefined, true)).toBe("qmd not installed")
    expect(verifyTesting.summarizeQmdIssue("ERR_DLOPEN_FAILED better_sqlite3.node", false)).toContain(
      "native module failed to load",
    )
    expect(verifyTesting.summarizeQmdIssue("first line\nsecond line", false)).toBe("first line")
    expect(tabsNode).toEqual({ type: "tabs", children: [] })
    expect(verifyTesting.formatVaultFolderLabel("/tmp/00 Inbox")).toBe("Inbox")
    expect(
      verifyTesting.formatCheck({
        name: "Plugins",
        status: "warn",
        detail: "extra installed",
      }),
    ).toBe("⚠️ Plugins: extra installed")
    expect(
      verifyTesting.formatSection({
        title: "Vault",
        checks: [{ name: "Path", status: "pass", detail: "~/zettelclaw" }],
      }),
    ).toBe("Vault\n✅ Path: ~/zettelclaw")
  })

  test("verify helper functions surface plugin, qmd, and openclaw drift", async () => {
    await withTempDir("zettelclaw-verify-helper-plugin-", async (dir) => {
      await writeTextFile(join(dir, ".obsidian", "community-plugins.json"), "{ nope")
      await expect(verifyTesting.buildPluginCheck(dir)).resolves.toMatchObject({
        status: "fail",
        detail: "community-plugins.json is not valid JSON",
      })
    })

    await withTempDir("zettelclaw-verify-helper-plugin-warn-", async (dir) => {
      await writeJsonFile(join(dir, ".obsidian", "community-plugins.json"), ["calendar"])
      await writeTextFile(join(dir, ".obsidian", "plugins", "calendar", "main.js"), "")
      await writeTextFile(join(dir, ".obsidian", "plugins", "obsidian-git", "main.js"), "")

      await expect(verifyTesting.buildPluginCheck(dir)).resolves.toMatchObject({
        status: "warn",
        detail: expect.stringContaining("extra installed: obsidian-git"),
      })
    })

    await withTempDir("zettelclaw-verify-helper-qmd-", async (dir) => {
      const vaultPath = join(dir, "vault")
      const binDir = join(dir, "bin")
      const collections = expectedQmdCollections(vaultPath)
      const inboxCollection = collections[0]

      if (!inboxCollection) {
        throw new Error("expected inbox collection")
      }

      await writeExecutable(
        join(binDir, "qmd"),
        `#!/bin/sh
if [ "$1" = "collection" ] && [ "$2" = "list" ]; then
  printf '%s\\n' '${inboxCollection.name} (qmd://zettelclaw/${inboxCollection.name})'
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, () => {
        expect(verifyTesting.buildQmdChecks(vaultPath)).toEqual([
          {
            name: "Installed",
            status: "pass",
            detail: "qmd available",
          },
          {
            name: "Collections",
            status: "warn",
            detail: "configured: Inbox; missing: Notes, Journal, Attachments",
          },
        ])
      })

      await withEnv({ PATH: join(dir, "missing-bin") }, () => {
        expect(verifyTesting.buildQmdChecks(vaultPath)).toEqual([
          {
            name: "Installed",
            status: "warn",
            detail: "qmd not installed",
          },
          {
            name: "Collections",
            status: "warn",
            detail: "skipped until QMD is installed",
          },
        ])
      })
    })

    await withTempDir("zettelclaw-verify-helper-openclaw-", async (dir) => {
      const workspacePath = join(dir, "workspace", "state")
      const configPath = join(dir, "workspace", "openclaw.json")
      await mkdir(workspacePath, { recursive: true })

      await expect(verifyTesting.buildOpenClawChecks("/vault", configPath)).resolves.toEqual([
        {
          name: "Settings",
          status: "warn",
          detail: expect.stringContaining("OpenClaw config not found"),
        },
        {
          name: "Memory paths",
          status: "warn",
          detail: "skipped until OpenClaw settings are available",
        },
      ])
    })
  })
})
