import { credentialsDir, fileSettingsStore } from "@mcp-cli/auth";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { Env, Settings } from "./types";
import { fail, isRecord } from "./values";

const invalid = (): never => fail("INVALID_CONFIG", "Invalid mem configuration.");
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return invalid();
  }
};
const string = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value : invalid();
const number = (value: unknown, maximum: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : invalid();

export const loadSettings = async (path: string, env: Env): Promise<Settings> => {
  let config: unknown = {};
  try {
    config = parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return invalid();
  }
  if (!isRecord(config)) return invalid();
  const stored = await memSettingsStore(env).read("mem");
  const plugin = stored?.configuration;
  if (plugin !== undefined && !isRecord(plugin)) return invalid();
  config = { ...config, ...(isRecord(plugin) ? plugin : {}) };
  return decodeSettings(config, env);
};

export const memSettingsStore = (env: Env) =>
  fileSettingsStore(join(dirname(credentialsDir(env)), "settings"));

export const decodeSettings = (config: unknown, env: Env = {}): Settings => {
  if (!isRecord(config)) return invalid();
  const keys = [
    "model",
    "baseUrl",
    "nodeBytes",
    "contextBytes",
    "inputBytes",
    "timeoutMs",
    "maxOutputTokens",
    "thinking",
  ];
  if (Object.keys(config).some((key) => !keys.includes(key))) return invalid();
  const settings: Settings = {
    model: config.model === undefined || config.model === "" ? "" : string(config.model),
    baseUrl: config.baseUrl === undefined || config.baseUrl === "" ? "" : string(config.baseUrl),
    nodeBytes: config.nodeBytes === undefined ? 512 : number(config.nodeBytes, 1_048_576),
    contextBytes:
      config.contextBytes === undefined ? 8192 : number(config.contextBytes, 16_777_216),
    inputBytes: config.inputBytes === undefined ? 131072 : number(config.inputBytes, 16_777_216),
    timeoutMs: config.timeoutMs === undefined ? 60000 : number(config.timeoutMs, 3_600_000),
    maxOutputTokens:
      config.maxOutputTokens === undefined ? 4096 : number(config.maxOutputTokens, 32768),
  };
  if (env.MEM_MODEL !== undefined) settings.model = string(env.MEM_MODEL);
  if (env.MEM_BASE_URL !== undefined) settings.baseUrl = string(env.MEM_BASE_URL);
  if (env.MEM_SUMMARIZER_COMMAND !== undefined) return invalid();
  if (env.MEM_NODE_BYTES !== undefined)
    settings.nodeBytes = number(Number(env.MEM_NODE_BYTES), 1_048_576);
  if (env.MEM_MAX_OUTPUT_TOKENS !== undefined)
    settings.maxOutputTokens = number(Number(env.MEM_MAX_OUTPUT_TOKENS), 32768);
  const thinking = env.MEM_THINKING ?? config.thinking;
  if (thinking !== undefined && thinking !== "default") {
    if (thinking !== "enabled" && thinking !== "disabled") return invalid();
    settings.thinking = thinking;
  }
  try {
    if (!settings.baseUrl) return settings;
    const url = new URL(settings.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return invalid();
  } catch {
    return invalid();
  }
  return settings;
};
