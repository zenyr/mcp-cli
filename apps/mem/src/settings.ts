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
const command = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) return invalid();
  return value.map((item: unknown) => string(item));
};

export const loadSettings = async (path: string, env: Env): Promise<Settings> => {
  let config: unknown = {};
  try {
    config = parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return invalid();
  }
  if (!isRecord(config)) return invalid();
  const keys = [
    "model",
    "baseUrl",
    "command",
    "nodeBytes",
    "contextBytes",
    "inputBytes",
    "timeoutMs",
  ];
  if (Object.keys(config).some((key) => !keys.includes(key))) return invalid();
  const settings: Settings = {
    model: config.model === undefined ? "deepseek-v4.1-flash" : string(config.model),
    baseUrl: config.baseUrl === undefined ? "http://127.0.0.1:8317/v1" : string(config.baseUrl),
    nodeBytes: config.nodeBytes === undefined ? 512 : number(config.nodeBytes, 1_048_576),
    contextBytes:
      config.contextBytes === undefined ? 8192 : number(config.contextBytes, 16_777_216),
    inputBytes: config.inputBytes === undefined ? 131072 : number(config.inputBytes, 16_777_216),
    timeoutMs: config.timeoutMs === undefined ? 60000 : number(config.timeoutMs, 3_600_000),
  };
  if (config.command !== undefined) settings.command = command(config.command);
  if (env.MEM_MODEL !== undefined) settings.model = string(env.MEM_MODEL);
  if (env.MEM_BASE_URL !== undefined) settings.baseUrl = string(env.MEM_BASE_URL);
  if (env.MEM_SUMMARIZER_COMMAND !== undefined)
    settings.command = command(parse(env.MEM_SUMMARIZER_COMMAND));
  if (env.MEM_NODE_BYTES !== undefined)
    settings.nodeBytes = number(Number(env.MEM_NODE_BYTES), 1_048_576);
  try {
    const url = new URL(settings.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return invalid();
  } catch {
    return invalid();
  }
  return settings;
};
