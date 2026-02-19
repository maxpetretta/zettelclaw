import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SYSTEM_PROMPT = `You are a knowledge extraction agent. Given a conversation transcript, produce a structured journal entry and optionally extract atomic notes.

Your output has two parts:

## 1. Journal Entry (ALWAYS required)
Summarize the session into these sections. Omit a section if nothing fits it. Use bullet points. Use [[wikilinks]] for concepts/projects/people.
- **Done**: What was accomplished
- **Decisions**: Key decisions made and their reasoning
- **Open**: Unresolved questions, blockers, next steps
- **Notes**: Observations, ideas, things to remember

## 2. Atomic Notes (ONLY when warranted)
Extract standalone notes ONLY for genuinely reusable concepts or insights — things that would be valuable outside the context of this conversation. Most sessions produce zero atomic notes. This is expected.

Rules for atomic notes:
- Each captures ONE idea. The title IS the idea in Title Case.
- Skip anything that's just "we did X" — that belongs in the journal
- Skip troubleshooting steps, routine work, and project-specific progress
- Only extract if the insight is reusable and stands alone
- Include [[wikilinks]] to related concepts
- Tags are always pluralized ("projects" not "project")

Respond with JSON only:
{
  "done": ["- bullet point with [[wikilinks]]"],
  "decisions": ["- bullet point"],
  "open": ["- bullet point"],
  "journalNotes": ["- bullet point"],
  "notes": [
    {
      "title": "Note Title In Title Case",
      "type": "note",
      "tags": ["tag1", "tag2"],
      "summary": "One-line summary",
      "body": "Full note content with [[wikilinks]].\\n\\nCan be multiple paragraphs.",
      "source": "conversation"
    }
  ]
}`;

export interface ExtractedNote {
  title: string;
  type: string;
  tags: string[];
  summary: string;
  body: string;
  source: string;
}

export interface SessionSummary {
  done: string[];
  decisions: string[];
  open: string[];
  journalNotes: string[];
  notes: ExtractedNote[];
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function parseSummaryOutput(rawOutput: string): SessionSummary | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parseCandidates = [withoutFence];
  const objStart = withoutFence.indexOf("{");
  const objEnd = withoutFence.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    parseCandidates.push(withoutFence.slice(objStart, objEnd + 1));
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        return {
          done: parseStringArray(record.done),
          decisions: parseStringArray(record.decisions),
          open: parseStringArray(record.open),
          journalNotes: parseStringArray(record.journalNotes),
          notes: parseNoteArray(record.notes),
        };
      }
      // Legacy format: bare array of notes
      if (Array.isArray(parsed)) {
        return {
          done: [],
          decisions: [],
          open: [],
          journalNotes: [],
          notes: parseNoteArray(parsed),
        };
      }
    } catch {
      // Keep trying candidate representations.
    }
  }

  return null;
}

// Keep old name for compatibility with CLI/gateway callers
function parseExtractionOutput(rawOutput: string): ExtractedNote[] | null {
  const summary = parseSummaryOutput(rawOutput);
  if (!summary) return null;
  return summary.notes;
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

// Kept for backward compatibility with extractNotesFromConversation
function runOpenClawCliTask(conversation: string, model: string | null): ExtractedNote[] | null {
  const result = runOpenClawCliSummary(conversation, model);
  return result ? result.notes : null;
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

// Kept for backward compatibility
async function runGatewayCompletion(
  conversation: string,
  cfg: unknown,
  model: string | null,
): Promise<ExtractedNote[] | null> {
  const result = await runGatewayCompletionSummary(conversation, cfg, model);
  return result ? result.notes : null;
}

const EMPTY_SUMMARY: SessionSummary = { done: [], decisions: [], open: [], journalNotes: [], notes: [] };

function runOpenClawCliSummary(conversation: string, model: string | null): SessionSummary | null {
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

  return parseSummaryOutput(parsedText);
}

async function runGatewayCompletionSummary(
  conversation: string,
  cfg: unknown,
  model: string | null,
): Promise<SessionSummary | null> {
  const port = await readGatewayPort(cfg);
  const completionModel = model ?? "gpt-4o-mini";

  try {
    const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: completionModel,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: conversation },
        ],
      }),
    });

    if (!response.ok) return null;

    const payload = asRecord(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const firstChoice = choices[0];
    if (!firstChoice || typeof firstChoice !== "object") return null;

    const message = asRecord((firstChoice as Record<string, unknown>).message);
    const content = contentToString(message.content);
    if (!content) return null;

    return parseSummaryOutput(content);
  } catch {
    return null;
  }
}

export async function extractSessionSummary(
  conversation: string,
  options: ExtractOptions,
): Promise<SessionSummary> {
  const log = options.logger ?? (() => {});
  const configuredModel = options.model?.trim() || readModelFromConfig(options.cfg);

  const cliResult = runOpenClawCliSummary(conversation, configuredModel);
  if (cliResult !== null) {
    return cliResult;
  }

  const gatewayResult = await runGatewayCompletionSummary(conversation, options.cfg, configuredModel);
  if (gatewayResult !== null) {
    return gatewayResult;
  }

  log("Failed to extract session summary via openclaw CLI and gateway API fallback.");
  return EMPTY_SUMMARY;
}

/** @deprecated Use extractSessionSummary instead */
export async function extractNotesFromConversation(
  conversation: string,
  options: ExtractOptions,
): Promise<ExtractedNote[]> {
  const result = await extractSessionSummary(conversation, options);
  return result.notes;
}
