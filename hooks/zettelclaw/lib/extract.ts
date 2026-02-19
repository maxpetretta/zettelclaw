import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SYSTEM_PROMPT = `You are a knowledge extraction agent. Given a conversation transcript, extract atomic ideas worth preserving as permanent notes.

Rules:
- Each note captures ONE idea (atomic). The title IS the idea.
- Title format: Title Case, opinionated/descriptive (e.g., "React Virtual DOM Trades Memory For Speed")
- Skip mundane chatter, greetings, troubleshooting steps that aren't reusable insights
- Skip anything that's just "we did X" without a reusable takeaway
- If nothing is worth extracting, return an empty array
- Include wikilinks to related concepts using [[Double Brackets]]
- Add relevant tags (always pluralized: "projects" not "project")

Respond with JSON only — an array of objects:
[
  {
    "title": "Note Title In Title Case",
    "type": "note",
    "tags": ["tag1", "tag2"],
    "summary": "One-line summary of the idea",
    "body": "The full note content with [[wikilinks]] to related concepts.\\n\\nCan be multiple paragraphs.",
    "source": "conversation"
  }
]

If nothing worth extracting, respond with: []`;

export interface ExtractedNote {
  title: string;
  type: string;
  tags: string[];
  summary: string;
  body: string;
  source: string;
}

interface ExtractOptions {
  cfg?: unknown;
  model?: string;
  logger?: (message: string) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function contentToString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => contentToString(item))
      .filter((item) => item.length > 0)
      .join("\n")
      .trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text.trim();
  }

  return contentToString(record.content);
}

function parseNoteArray(value: unknown): ExtractedNote[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const notes: ExtractedNote[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) {
      continue;
    }

    const tags = Array.isArray(record.tags)
      ? record.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      : [];

    notes.push({
      title,
      type: typeof record.type === "string" && record.type.trim().length > 0 ? record.type.trim() : "note",
      tags,
      summary:
        typeof record.summary === "string" && record.summary.trim().length > 0
          ? record.summary.trim()
          : title,
      body: typeof record.body === "string" && record.body.trim().length > 0 ? record.body.trim() : title,
      source:
        typeof record.source === "string" && record.source.trim().length > 0
          ? record.source.trim()
          : "conversation",
    });
  }

  return notes;
}

function parseExtractionOutput(rawOutput: string): ExtractedNote[] | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return [];
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parseCandidates = [withoutFence];
  const arrayStart = withoutFence.indexOf("[");
  const arrayEnd = withoutFence.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    parseCandidates.push(withoutFence.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parseNoteArray(parsed);
    } catch {
      // Keep trying candidate representations.
    }
  }

  return null;
}

function readModelFromConfig(cfg: unknown): string | null {
  const cfgRecord = asRecord(cfg);

  const directModel = cfgRecord.model;
  if (typeof directModel === "string" && directModel.trim().length > 0) {
    return directModel.trim();
  }

  const llmConfig = asRecord(cfgRecord.llm);
  const llmModel = llmConfig.model;
  if (typeof llmModel === "string" && llmModel.trim().length > 0) {
    return llmModel.trim();
  }

  return null;
}

function parseCliOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }

    const record = asRecord(parsed);
    for (const key of ["output", "content", "result", "text"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function runOpenClawCliTask(conversation: string, model: string | null): ExtractedNote[] | null {
  const args = ["llm-task", "--system", SYSTEM_PROMPT, "--json"];
  if (model) {
    args.push("--model", model);
  }

  const result = spawnSync("openclaw", args, {
    input: conversation,
    encoding: "utf8",
    timeout: 45_000,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const parsedText = parseCliOutput(result.stdout ?? "");
  if (!parsedText.trim()) {
    return null;
  }

  const parsed = parseExtractionOutput(parsedText);
  return parsed;
}

async function readGatewayPort(cfg: unknown): Promise<number> {
  const cfgRecord = asRecord(cfg);
  const gateway = asRecord(cfgRecord.gateway);

  if (typeof gateway.port === "number" && Number.isFinite(gateway.port)) {
    return gateway.port;
  }

  if (typeof cfgRecord.gatewayPort === "number" && Number.isFinite(cfgRecord.gatewayPort)) {
    return cfgRecord.gatewayPort;
  }

  try {
    const gatewayConfigPath = join(homedir(), ".openclaw", "gateway.json");
    const raw = await readFile(gatewayConfigPath, "utf8");
    const parsed = asRecord(JSON.parse(raw));

    if (typeof parsed.port === "number" && Number.isFinite(parsed.port)) {
      return parsed.port;
    }

    const http = asRecord(parsed.http);
    if (typeof http.port === "number" && Number.isFinite(http.port)) {
      return http.port;
    }
  } catch {
    // Fall through to default.
  }

  return 3456;
}

async function runGatewayCompletion(
  conversation: string,
  cfg: unknown,
  model: string | null,
): Promise<ExtractedNote[] | null> {
  const port = await readGatewayPort(cfg);
  const completionModel = model ?? "gpt-4o-mini";

  try {
    const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: completionModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: conversation },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = asRecord(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== "object") {
      return null;
    }

    const message = asRecord((firstChoice as Record<string, unknown>).message);
    const content = contentToString(message.content);
    if (!content) {
      return null;
    }

    return parseExtractionOutput(content);
  } catch {
    return null;
  }
}

export async function extractNotesFromConversation(
  conversation: string,
  options: ExtractOptions,
): Promise<ExtractedNote[]> {
  const log = options.logger ?? (() => {});
  const configuredModel = options.model?.trim() || readModelFromConfig(options.cfg);

  const cliResult = runOpenClawCliTask(conversation, configuredModel);
  if (cliResult !== null) {
    return cliResult;
  }

  const gatewayResult = await runGatewayCompletion(conversation, options.cfg, configuredModel);
  if (gatewayResult !== null) {
    return gatewayResult;
  }

  log("Failed to extract notes via openclaw CLI and gateway API fallback.");
  return [];
}
