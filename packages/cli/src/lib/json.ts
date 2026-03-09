export type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return {}
}

export function asOptionalRecord(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }

  return undefined
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

export function parseJsonValue(raw: string | undefined): unknown {
  if (!raw) {
    return undefined
  }

  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function parseJsonRecord(raw: string | undefined): JsonRecord | undefined {
  return asOptionalRecord(parseJsonValue(raw))
}
