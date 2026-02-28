export interface PluginConfig {
  logDir: string;
  extraction: {
    model: string;
    skipSessionTypes: string[];
  };
  briefing: {
    model: string;
    activeWindow: number;
    decisionWindow: number;
    staleThreshold: number;
    maxLines: number;
  };
  cron: {
    schedule: string;
    timezone: string;
  };
}

const DEFAULT_CONFIG: PluginConfig = {
  logDir: "~/.openclaw/zettelclaw",
  extraction: {
    model: "anthropic/claude-sonnet-4-6",
    skipSessionTypes: ["cron:", "sub:", "hook:"],
  },
  briefing: {
    model: "anthropic/claude-sonnet-4-6",
    activeWindow: 14,
    decisionWindow: 7,
    staleThreshold: 30,
    maxLines: 80,
  },
  cron: {
    schedule: "0 3 * * *",
    timezone: "UTC",
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : fallback;
}

function expandHomePath(input: string): string {
  if (input === "~") {
    return `${process.env.HOME ?? ""}`;
  }

  if (input.startsWith("~/")) {
    const home = process.env.HOME ?? "";
    return `${home}${input.slice(1)}`;
  }

  return input;
}

export function resolveConfig(
  rawConfig: unknown,
  _openClawConfig?: unknown,
): PluginConfig {
  const raw = isObject(rawConfig) ? rawConfig : {};
  const extractionRaw = isObject(raw.extraction) ? raw.extraction : {};
  const briefingRaw = isObject(raw.briefing) ? raw.briefing : {};
  const cronRaw = isObject(raw.cron) ? raw.cron : {};

  const timezoneDefault =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";

  const logDir = readString(raw.logDir, DEFAULT_CONFIG.logDir);

  return {
    logDir: expandHomePath(logDir),
    extraction: {
      model: readString(extractionRaw.model, DEFAULT_CONFIG.extraction.model),
      skipSessionTypes: readStringArray(
        extractionRaw.skipSessionTypes,
        DEFAULT_CONFIG.extraction.skipSessionTypes,
      ),
    },
    briefing: {
      model: readString(briefingRaw.model, DEFAULT_CONFIG.briefing.model),
      activeWindow: readNumber(briefingRaw.activeWindow, DEFAULT_CONFIG.briefing.activeWindow),
      decisionWindow: readNumber(briefingRaw.decisionWindow, DEFAULT_CONFIG.briefing.decisionWindow),
      staleThreshold: readNumber(briefingRaw.staleThreshold, DEFAULT_CONFIG.briefing.staleThreshold),
      maxLines: readNumber(briefingRaw.maxLines, DEFAULT_CONFIG.briefing.maxLines),
    },
    cron: {
      schedule: readString(cronRaw.schedule, DEFAULT_CONFIG.cron.schedule),
      timezone: readString(cronRaw.timezone, timezoneDefault),
    },
  };
}

export function defaultConfig(): PluginConfig {
  return structuredClone(DEFAULT_CONFIG);
}
