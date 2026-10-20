import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { isRecord, UsageError } from "@mcp-cli/core";
import { configPath, expandHome, type Env } from "./paths";

export const ensureConfigDirectory = async (env: Env = process.env): Promise<void> => {
  const path = configPath({ env, home: env.HOME || homedir() });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
};

export type PluginReference =
  | { kind: "path"; value: string; dir: string }
  | { kind: "package"; value: string };
export type UserConfig = { path: string; plugins: PluginReference[] };

const specifierPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

const reference = (
  value: unknown,
  index: number,
  home: string,
  fail: (reason: string) => UsageError,
): PluginReference => {
  if (typeof value !== "string" || !value) throw fail(`plugins[${index}] must be a string`);
  if (value.startsWith("/") || value === "~" || value.startsWith("~/"))
    return { kind: "path", value, dir: expandHome(value, home) };
  if (!specifierPattern.test(value))
    throw fail(`plugins[${index}] must be a package name or an absolute or ~ path: ${value}`);
  return { kind: "package", value };
};

export const decodeConfig = (value: unknown, path: string, home: string): UserConfig => {
  const fail = (reason: string) => new UsageError(`Invalid config ${path}: ${reason}`);
  if (!isRecord(value)) throw fail("expected a JSON object");
  for (const key of Object.keys(value))
    if (key !== "plugins") throw fail(`unknown key ${JSON.stringify(key)}`);
  const plugins = value.plugins ?? [];
  if (!Array.isArray(plugins)) throw fail("plugins must be an array");
  return { path, plugins: plugins.map((item, i) => reference(item, i, home, fail)) };
};

// A missing default config means no extra plugins; an explicit $MCP_CLI_CONFIG must exist.
export const readConfig = async (
  path: string,
  home: string,
  required: boolean,
): Promise<UserConfig> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    if (required) throw new UsageError(`Config file not found: ${path}`);
    return { path, plugins: [] };
  }
  const text = await file.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UsageError(`Invalid config ${path}: ${reason}`);
  }
  return decodeConfig(value, path, home);
};
