export const IMPORT_PLATFORMS = ["chatgpt", "claude", "grok"] as const;

export type ImportPlatform = (typeof IMPORT_PLATFORMS)[number];

export type ImportedRole = "system" | "user" | "assistant";

export interface ImportedMessage {
  id: string;
  role: ImportedRole;
  content: string;
  createdAt: string;
}

export interface ImportedConversation {
  platform: ImportPlatform;
  conversationId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ImportedMessage[];
}
