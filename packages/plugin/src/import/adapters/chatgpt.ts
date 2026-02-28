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
  const resolved = parseTimestampMs(value) ?? fallbackMs;
  return new Date(resolved).toISOString();
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value.replaceAll(/\s+/gu, " ").trim();
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => extractText(item)).filter((part) => part.length > 0);
    return parts.join("\n").trim();
  }

  if (!isObject(value)) {
    return "";
  }

  if (Array.isArray(value.parts)) {
    const parts = value.parts
      .map((part) => extractText(part))
      .filter((part): part is string => part.length > 0);
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
  }

  if (typeof value.text === "string") {
    return value.text.replaceAll(/\s+/gu, " ").trim();
  }

  if (typeof value.result === "string") {
    return value.result.replaceAll(/\s+/gu, " ").trim();
  }

  return "";
}

function normalizeRole(value: unknown): ImportedRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const role = value.trim().toLowerCase();
  if (role === "user" || role === "human") {
    return "user";
  }

  if (role === "assistant" || role === "ai" || role === "model") {
    return "assistant";
  }

  if (role === "system") {
    return "system";
  }

  return null;
}

function extractMessageFromNode(node: Record<string, unknown>, fallbackMs: number): ImportedMessage | null {
  const message = isObject(node.message) ? node.message : null;
  if (!message) {
    return null;
  }

  const author = isObject(message.author) ? message.author : null;
  const role = normalizeRole(author?.role ?? node.role);
  if (!role) {
    return null;
  }

  const content = extractText(message.content ?? node.content);
  if (!content) {
    return null;
  }

  const id = readString(message.id) ?? readString(node.id) ?? `${role}-${fallbackMs}`;
  const createdAt = toIso(message.create_time ?? node.create_time ?? message.update_time ?? node.update_time, fallbackMs);

  return {
    id,
    role,
    content,
    createdAt,
  };
}

function collectPathNodeIds(mapping: Record<string, unknown>, currentNode: string | undefined): string[] {
  if (!currentNode || !isObject(mapping[currentNode])) {
    return [];
  }

  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = currentNode;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);

    const current = mapping[cursor];
    if (!isObject(current)) {
      break;
    }

    const parent = readString(current.parent);
    if (!parent || !isObject(mapping[parent])) {
      break;
    }

    cursor = parent;
  }

  path.reverse();
  return path;
}

function parseMessagesFromMapping(
  mappingRaw: unknown,
  currentNodeRaw: unknown,
  fallbackMs: number,
): ImportedMessage[] {
  if (!isObject(mappingRaw)) {
    return [];
  }

  const mapping = mappingRaw;
  const currentNode = readString(currentNodeRaw);
  const preferredPath = collectPathNodeIds(mapping, currentNode);

  const seenIds = new Set<string>();
  const collected: ImportedMessage[] = [];

  const appendFromNodeId = (nodeId: string): void => {
    const nodeValue = mapping[nodeId];
    if (!isObject(nodeValue)) {
      return;
    }

    const parsed = extractMessageFromNode(nodeValue, fallbackMs);
    if (!parsed || seenIds.has(parsed.id)) {
      return;
    }

    seenIds.add(parsed.id);
    collected.push(parsed);
  };

  for (const nodeId of preferredPath) {
    appendFromNodeId(nodeId);
  }

  if (collected.length > 0) {
    return collected;
  }

  const nodes = Object.values(mapping)
    .filter(isObject)
    .map((node) => {
      const parsed = extractMessageFromNode(node, fallbackMs);
      return parsed
        ? {
            message: parsed,
            createdAtMs: Date.parse(parsed.createdAt),
          }
        : null;
    })
    .filter((item): item is { message: ImportedMessage; createdAtMs: number } => item !== null)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);

  for (const node of nodes) {
    if (seenIds.has(node.message.id)) {
      continue;
    }

    seenIds.add(node.message.id);
    collected.push(node.message);
  }

  return collected;
}

function parseMessagesFallback(messagesRaw: unknown, fallbackMs: number): ImportedMessage[] {
  if (!Array.isArray(messagesRaw)) {
    return [];
  }

  const messages: ImportedMessage[] = [];
  const seenIds = new Set<string>();

  for (const raw of messagesRaw) {
    if (!isObject(raw)) {
      continue;
    }

    const role = normalizeRole(raw.role ?? raw.author);
    if (!role) {
      continue;
    }

    const content = extractText(raw.content ?? raw.text ?? raw.message);
    if (!content) {
      continue;
    }

    const id = readString(raw.id) ?? `${role}-${messages.length + 1}`;
    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    messages.push({
      id,
      role,
      content,
      createdAt: toIso(raw.created_at ?? raw.create_time ?? raw.timestamp ?? raw.time, fallbackMs),
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
  const conversationId = readString(raw.id) ?? readString(raw.conversation_id) ?? `chatgpt-${index + 1}`;
  const title = readString(raw.title) ?? `ChatGPT import ${index + 1}`;

  const fromMapping = parseMessagesFromMapping(raw.mapping, raw.current_node, now);
  const fromArray = fromMapping.length > 0 ? fromMapping : parseMessagesFallback(raw.messages, now);
  const messages = fromArray.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));

  const firstMessageAt = messages.length > 0 ? Date.parse(messages[0].createdAt) : now;
  const lastMessageAt = messages.length > 0 ? Date.parse(messages[messages.length - 1].createdAt) : firstMessageAt;

  const createdAt = toIso(raw.create_time ?? raw.created_at ?? firstMessageAt, firstMessageAt);
  const updatedAt = toIso(raw.update_time ?? raw.updated_at ?? lastMessageAt, lastMessageAt);

  return {
    platform: "chatgpt",
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

export function parseChatGptConversations(raw: unknown): ImportedConversation[] {
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
