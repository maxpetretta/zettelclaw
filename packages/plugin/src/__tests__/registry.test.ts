import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureSubject,
  readRegistry,
  renameSubject,
  slugToDisplay,
  writeRegistry,
} from "../subjects/registry";

describe("registry", () => {
  let tempDir = "";
  let registryPath = "";
  let logPath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zettelclaw-registry-"));
    registryPath = join(tempDir, "subjects.json");
    logPath = join(tempDir, "log.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("readRegistry returns empty object when missing", async () => {
    expect(await readRegistry(registryPath)).toEqual({});
  });

  test("writeRegistry/readRegistry round trip", async () => {
    const registry = {
      "auth-migration": { display: "Auth Migration", type: "project" },
    };

    await writeRegistry(registryPath, registry);
    expect(await readRegistry(registryPath)).toEqual(registry);
  });

  test("ensureSubject auto-creates missing slug", async () => {
    await ensureSubject(registryPath, "auth-migration");
    await ensureSubject(registryPath, "max", "person");

    const registry = await readRegistry(registryPath);
    expect(registry["auth-migration"]).toEqual({
      display: "Auth Migration",
      type: "project",
    });
    expect(registry.max).toEqual({ display: "Max", type: "person" });
  });

  test("renameSubject updates registry and log", async () => {
    await writeRegistry(registryPath, {
      old: { display: "Old", type: "project" },
    });

    await Bun.write(
      logPath,
      '{"id":"aaaaaaaaaaaa","timestamp":"2026-02-20T00:00:00.000Z","type":"fact","content":"note","subject":"old","session":"s1"}\n',
    );

    await renameSubject(registryPath, logPath, "old", "new");

    const registry = await readRegistry(registryPath);
    expect(registry.old).toBeUndefined();
    expect(registry.new).toEqual({ display: "Old", type: "project" });

    const logContent = await readFile(logPath, "utf8");
    expect(logContent).toContain('"subject":"new"');
    expect(logContent).not.toContain('"subject":"old"');
  });

  test("slugToDisplay converts kebab-case to Title Case", () => {
    expect(slugToDisplay("auth-migration")).toBe("Auth Migration");
  });
});
