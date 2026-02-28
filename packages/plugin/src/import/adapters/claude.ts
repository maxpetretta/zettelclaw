import type { ImportedConversation, ImportedMessage, ImportedRole } from "../types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      return Math.floor(value);
    }

    if (value > 1e9) {
      return Math.floor(value * 1000);
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return parseTimestampMs(numeric);
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toIso(value: unknown, fallbackMs: number): string {
  return new Date(parseTimestampMs(value) ?? fallbackMs).toISOString();
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value.replaceAll(/\s+/gu, " ").trim();
  }

  if (Array.isArray(value)) {
    const parts = value.map((part) => extractText(part)).filter((part) => part.length > 0);
    return parts.join("\n").trim();
  }

  if (!isObject(value)) {
    return "";
  }

  if (Array.isArray(value.parts)) {
    const parts = value.parts.map((part) => extractText(part)).filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  if (Array.isArray(value.content)) {
    const parts = value.content.map((part) => extractText(part)).filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  if (typeof value.text === "string") {
    return value.text.replaceAll(/\s+/gu, " ").trim();
  }

  if (typeof value.input_text === "string") {
    return value.input_text.replaceAll(/\s+/gu, " ").trim();
  }

  if (typeof value.value === "string") {
    return value.value.replaceAll(/\s+/gu, " ").trim();
  }

  return "";
}

function normalizeRole(value: unknown): ImportedRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const role = value.trim().toLowerCase();
  if (role === "human" || role === "user") {
    return "user";
  }

  if (role === "assistant" || role === "claude" || role === "ai" || role === "model") {
    return "assistant";
  }

  if (role === "system") {
    return "system";
  }

  return null;
}

function readMessages(raw: Record<string, unknown>, fallbackMs: number): ImportedMessage[] {
  const source =
    (Array.isArray(raw.chat_messages) ? raw.chat_messages : undefined) ??
    (Array.isArray(raw.messages) ? raw.messages : undefined) ??
    (Array.isArray(raw.entries) ? raw.entries : undefined) ??
    [];

  const messages: ImportedMessage[] = [];
  const seen = new Set<string>();

  for (const [index, messageRaw] of source.entries()) {
    if (!isObject(messageRaw)) {
      continue;
    }

    const role = normalizeRole(
      messageRaw.sender ??
        messageRaw.role ??
        (isObject(messageRaw.author) ? messageRaw.author.role : undefined),
    );
    if (!role) {
      continue;
    }

    const content = extractText(messageRaw.text ?? messageRaw.content ?? messageRaw.message ?? messageRaw.body);
    if (!content) {
      continue;
    }

    const id =
      readString(messageRaw.uuid) ??
      readString(messageRaw.id) ??
      readString(messageRaw.message_uuid) ??
      `${role}-${index + 1}`;

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    messages.push({
      id,
      role,
      content,
      createdAt: toIso(
        messageRaw.created_at ??
          messageRaw.createdAt ??
          messageRaw.updated_at ??
          messageRaw.updatedAt ??
          messageRaw.timestamp,
        fallbackMs,
      ),
    });
  }

  messages.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return messages;
}

function parseConversation(raw: unknown, index: number): ImportedConversation | null {
  if (!isObject(raw)) {
    return null;
  }

  const now = Date.now();
  const messages = readMessages(raw, now);
  const firstMessageAt = messages.length > 0 ? Date.parse(messages[0].createdAt) : now;
  const lastMessageAt = messages.length > 0 ? Date.parse(messages[messages.length - 1].createdAt) : firstMessageAt;

  const conversationId =
    readString(raw.uuid) ?? readString(raw.id) ?? readString(raw.conversation_uuid) ?? `claude-${index + 1}`;

  const title = readString(raw.name) ?? readString(raw.title) ?? `Claude import ${index + 1}`;
  const createdAt = toIso(raw.created_at ?? raw.createdAt ?? firstMessageAt, firstMessageAt);
  const updatedAt = toIso(
    raw.updated_at ?? raw.updatedAt ?? raw.last_message_at ?? raw.lastMessageAt ?? lastMessageAt,
    lastMessageAt,
  );

  return {
    platform: "claude",
    conversationId,
    title,
    createdAt,
    updatedAt,
    messages,
  };
}

function readConversationList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (!isObject(raw)) {
    return [];
  }

  if (Array.isArray(raw.conversations)) {
    return raw.conversations;
  }

  if (Array.isArray(raw.data)) {
    return raw.data;
  }

  return [];
}

export function parseClaudeConversations(raw: unknown): ImportedConversation[] {
  const conversations: ImportedConversation[] = [];

  for (const [index, conversationRaw] of readConversationList(raw).entries()) {
    const parsed = parseConversation(conversationRaw, index);
    if (!parsed) {
      continue;
    }

    conversations.push(parsed);
  }

  return conversations;
}
