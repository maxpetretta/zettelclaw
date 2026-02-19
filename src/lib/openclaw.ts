import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { NotesMode } from "./vault";

const AGENTS_MARKER = "zettelclaw-agents";
const MEMORY_MARKER = "zettelclaw-memory";
const HEARTBEAT_MARKER = "zettelclaw-heartbeat";

interface WorkspaceContext {
  vaultPath: string;
  notesMode: NotesMode;
  symlinksEnabled: boolean;
}

function section(marker: string, body: string): string {
  return [
    `<!-- ${marker}:start -->`,
    body.trimEnd(),
    `<!-- ${marker}:end -->`,
    "",
  ].join("\n");
}

async function appendSectionIfMissing(path: string, marker: string, body: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {
    existing = "";
  }

  if (existing.includes(`<!-- ${marker}:start -->`)) {
    return false;
  }

  const next = `${existing.trimEnd()}\n\n${section(marker, body)}`.trimStart();
  await writeFile(path, `${next}\n`, "utf8");
  return true;
}

function agentsContent(context: WorkspaceContext): string {
  const notesLocation = context.notesMode === "notes" ? "`Notes/`" : "the vault root";

  return `
## Zettelclaw Vault Conventions

- Vault path: \`${context.vaultPath}\`
- Note location: ${notesLocation}
- Required frontmatter \`type\` values: \`note\`, \`daily\`, \`project\`, \`research\`, \`contact\`, \`writing\`
- Only \`project\` and \`research\` may use \`status\`.
- Always use title-case filenames, \`YYYY-MM-DD\` dates, and pluralized tags.
- Link aggressively with \`[[wikilinks]]\` and keep source provenance in \`source\` when possible.
- Do not create nested folders under \`Notes/\` (or the root note area in root mode).
- Triage \`Inbox/\` during heartbeat cycles and extract durable notes from workspace dailies.
`;
}

function memoryContent(context: WorkspaceContext): string {
  return `
## Zettelclaw Setup Context

- Vault path: \`${context.vaultPath}\`
- Notes mode: \`${context.notesMode}\`
- Agent symlinks enabled: \`${context.symlinksEnabled ? "yes" : "no"}\`
- Vault note types: \`note\`, \`daily\`, \`project\`, \`research\`, \`contact\`, \`writing\`
`;
}

function heartbeatContent(): string {
  return `
## Zettelclaw Extraction Tasks

- Review recent workspace dailies in \`memory/YYYY-MM-DD.md\` for extractable ideas.
- Convert durable insights into vault notes with complete frontmatter.
- Link new notes to relevant existing notes.
- Update project notes with progress logs and decisions.
- Triage \`Inbox/\` captures into proper notes or archive them.
- Surface notes that need missing links, sources, or summaries.
`;
}

export function gatewayPatchSnippet(vaultPath: string): string {
  return [
    "memorySearch:",
    "  extraPaths:",
    `    - \"${vaultPath}\"`,
  ].join("\n");
}

export async function appendWorkspaceIntegration(
  workspacePath: string,
  context: WorkspaceContext,
): Promise<{ added: string[]; skipped: string[] }> {
  const files = [
    { path: join(workspacePath, "AGENTS.md"), marker: AGENTS_MARKER, body: agentsContent(context) },
    { path: join(workspacePath, "MEMORY.md"), marker: MEMORY_MARKER, body: memoryContent(context) },
    { path: join(workspacePath, "HEARTBEAT.md"), marker: HEARTBEAT_MARKER, body: heartbeatContent() },
  ];

  const added: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const created = await appendSectionIfMissing(file.path, file.marker, file.body);
    if (created) {
      added.push(file.path);
    } else {
      skipped.push(file.path);
    }
  }

  return { added, skipped };
}
