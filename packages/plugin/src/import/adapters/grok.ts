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

function readId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!isObject(value)) {
    return undefined;
  }

  if (typeof value.$oid === "string" && value.$oid.trim()) {
    return value.$oid.trim();
  }

  if (typeof value.id === "string" && value.id.trim()) {
    return value.id.trim();
  }

  return undefined;
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

  if (!isObject(value)) {
    return undefined;
  }

  if (Object.hasOwn(value, "$date")) {
    return parseTimestampMs(value.$date);
  }

  if (Object.hasOwn(value, "$numberLong")) {
    return parseTimestampMs(value.$numberLong);
  }

  if (Object.hasOwn(value, "value")) {
    return parseTimestampMs(value.value);
  }

  if (typeof value.seconds === "number" && Number.isFinite(value.seconds)) {
    const millis = value.seconds * 1000;
    const nanos =
      typeof value.nanos === "number" && Number.isFinite(value.nanos)
        ? Math.floor(value.nanos / 1_000_000)
        : 0;
    return Math.floor(millis + nanos);
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
  if (role === "user" || role === "human" || role === "prompt") {
    return "user";
  }

  if (role === "assistant" || role === "grok" || role === "ai" || role === "model") {
    return "assistant";
  }

  if (role === "system") {
    return "system";
  }

  return null;
}

function readMessageArray(raw: Record<string, unknown>): unknown[] {
  const direct =
    (Array.isArray(raw.messages) ? raw.messages : undefined) ??
    (Array.isArray(raw.turns) ? raw.turns : undefined) ??
    (Array.isArray(raw.chat_messages) ? raw.chat_messages : undefined) ??
    (Array.isArray(raw.entries) ? raw.entries : undefined);

  if (direct) {
    return direct;
  }

  if (isObject(raw.messagesById)) {
    return Object.values(raw.messagesById);
  }

  return [];
}

function readMessages(raw: Record<string, unknown>, fallbackMs: number): ImportedMessage[] {
  const source = readMessageArray(raw);
  const messages: ImportedMessage[] = [];
  const seen = new Set<string>();

  for (const [index, messageRaw] of source.entries()) {
    if (!isObject(messageRaw)) {
      continue;
    }

    const role = normalizeRole(
      messageRaw.role ??
        messageRaw.sender ??
        (isObject(messageRaw.author) ? messageRaw.author.role : undefined),
    );
    if (!role) {
      continue;
    }

    const content = extractText(
      messageRaw.content ??
        messageRaw.text ??
        messageRaw.message ??
        messageRaw.body ??
        messageRaw.query ??
        messageRaw.response,
    );
    if (!content) {
      continue;
    }

    const id = readId(messageRaw._id) ?? readString(messageRaw.id) ?? `${role}-${index + 1}`;
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    messages.push({
      id,
      role,
      content,
      createdAt: toIso(
        messageRaw.createdAt ??
          messageRaw.created_at ??
          messageRaw.timestamp ??
          messageRaw.time ??
          messageRaw.updatedAt ??
          messageRaw.updated_at,
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
    readId(raw._id) ??
    readString(raw.id) ??
    readString(raw.conversationId) ??
    readString(raw.uuid) ??
    `grok-${index + 1}`;

  const title = readString(raw.title) ?? readString(raw.name) ?? `Grok import ${index + 1}`;
  const createdAt = toIso(
    raw.createdAt ?? raw.created_at ?? raw.createTime ?? raw.startTime ?? firstMessageAt,
    firstMessageAt,
  );
  const updatedAt = toIso(
    raw.updatedAt ??
      raw.updated_at ??
      raw.updateTime ??
      raw.lastUpdatedAt ??
      raw.last_message_at ??
      lastMessageAt,
    lastMessageAt,
  );

  return {
    platform: "grok",
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

export function parseGrokConversations(raw: unknown): ImportedConversation[] {
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
