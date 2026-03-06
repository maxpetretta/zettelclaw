import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { ensureQmdCollections, expectedQmdCollections, installQmdGlobal, listQmdCollections } from "../qmd"
import { readTextFile, withEnv, withTempDir, writeExecutable } from "./test-helpers"

describe("qmd integration helpers", () => {
  test("builds expected collection names from the folder suffix", () => {
    expect(expectedQmdCollections("/tmp/My Vault")).toEqual([
      {
        name: "zettelclaw-inbox",
        path: "/tmp/My Vault/00 Inbox",
        mask: "**/*.md",
      },
      {
        name: "zettelclaw-notes",
        path: "/tmp/My Vault/01 Notes",
        mask: "**/*.md",
      },
      {
        name: "zettelclaw-journal",
        path: "/tmp/My Vault/02 Journal",
        mask: "**/*.md",
      },
      {
        name: "zettelclaw-attachments",
        path: "/tmp/My Vault/04 Attachments",
        mask: "**/*.md",
      },
    ])
  })

  test("reports missing qmd binaries", async () => {
    await withTempDir("zettelclaw-qmd-empty-path-", async (binDir) => {
      await withEnv({ PATH: binDir }, () => {
        expect(listQmdCollections()).toMatchObject({
          ok: false,
          missingBinary: true,
        })
        expect(ensureQmdCollections("/tmp/vault")).toMatchObject({
          skipped: true,
          missingBinary: true,
        })
      })
    })
  })

  test("parses qmd collection listings from the CLI", async () => {
    await withTempDir("zettelclaw-qmd-list-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "qmd"),
        `#!/bin/sh
if [ "$1" = "collection" ] && [ "$2" = "list" ]; then
  printf 'zettelclaw-demo-inbox (qmd://demo/inbox)\\n'
  printf 'zettelclaw-demo-notes (qmd://demo/notes)\\n'
  exit 0
fi
if [ "$1" = "--help" ]; then
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, () => {
        expect(listQmdCollections()).toEqual({
          ok: true,
          names: ["zettelclaw-demo-inbox", "zettelclaw-demo-notes"],
        })
      })
    })
  })

  test("surfaces qmd startup and listing failures", async () => {
    await withTempDir("zettelclaw-qmd-failures-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "qmd"),
        `#!/bin/sh
if [ "$1" = "--help" ]; then
  echo "startup failed"
  exit 2
fi
if [ "$1" = "collection" ] && [ "$2" = "list" ]; then
  echo "qmd unhappy" >&2
  exit 3
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir }, () => {
        expect(ensureQmdCollections("/tmp/vault")).toMatchObject({
          skipped: true,
          message: "startup failed",
        })
        expect(listQmdCollections()).toMatchObject({
          ok: false,
          names: [],
          message: "qmd unhappy",
        })
      })
    })
  })

  test("ensures qmd collections and records failures per collection", async () => {
    await withTempDir("zettelclaw-qmd-ensure-", async (dir) => {
      const binDir = join(dir, "bin")
      const logPath = join(dir, "qmd.log")

      await writeExecutable(
        join(binDir, "qmd"),
        `#!/bin/sh
if [ "$1" = "--help" ]; then
  exit 0
fi
if [ "$1" = "collection" ] && [ "$2" = "remove" ]; then
  exit 0
fi
if [ "$1" = "collection" ] && [ "$2" = "add" ]; then
  printf '%s\\n' "$5" >> "$QMD_LOG"
  case "$5" in
    *journal)
      echo "journal failed" >&2
      exit 1
      ;;
  esac
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir, QMD_LOG: logPath }, async () => {
        const result = ensureQmdCollections(join(dir, "vault"))
        const expectedNames = expectedQmdCollections(join(dir, "vault")).map((collection) => collection.name)

        expect(result.skipped).toBe(false)
        expect(result.configured).toEqual(expectedNames.filter((name) => !name.endsWith("-journal")))
        expect(result.failed).toEqual([`${expectedNames[2]}: journal failed`])
        expect((await readTextFile(logPath)).trim().split("\n")).toEqual(expectedNames)
      })
    })
  })

  test("installs qmd using the first available package manager", async () => {
    await withTempDir("zettelclaw-qmd-install-", async (dir) => {
      const binDir = join(dir, "bin")
      const installLog = join(dir, "install.log")

      await writeExecutable(
        join(binDir, "npm"),
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi
if [ "$1" = "install" ]; then
  printf '%s\\n' "$@" > "$INSTALL_LOG"
  exit 0
fi
exit 1
`,
      )

      await withEnv({ PATH: binDir, INSTALL_LOG: installLog }, async () => {
        await expect(installQmdGlobal()).resolves.toEqual({
          installed: true,
          command: "npm install -g @tobilu/qmd",
        })
        expect(await readTextFile(installLog)).toContain("@tobilu/qmd")
      })
    })
  })

  test("reports when no package manager is available and when installs fail", async () => {
    await withTempDir("zettelclaw-qmd-no-pm-", async (binDir) => {
      await withEnv({ PATH: binDir }, async () => {
        await expect(installQmdGlobal()).resolves.toEqual({
          installed: false,
          message: "Could not install QMD because neither `bun` nor `npm` was found on PATH.",
        })
      })
    })

    await withTempDir("zettelclaw-qmd-install-fail-", async (dir) => {
      const binDir = join(dir, "bin")
      await writeExecutable(
        join(binDir, "bun"),
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.3.5"
  exit 0
fi
echo "bun failed" >&2
exit 1
`,
      )
      await writeExecutable(
        join(binDir, "npm"),
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.0.0"
  exit 0
fi
echo "npm failed" >&2
exit 1
`,
      )

      await withEnv({ PATH: binDir }, async () => {
        await expect(installQmdGlobal()).resolves.toMatchObject({
          installed: false,
          message: expect.stringContaining("bun install -g @tobilu/qmd: bun failed"),
        })
        await expect(installQmdGlobal()).resolves.toMatchObject({
          installed: false,
          message: expect.stringContaining("npm install -g @tobilu/qmd: npm failed"),
        })
      })
    })
  })
})
