import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { bundledPlugins } from "./bundled";
import { standalone } from "./marketplace/commands";

export type Env = Record<string, string | undefined>;

/** Roots and environment that discovery reads, injectable so tests never touch the real home. */
export type DiscoveryContext = {
  env: Env;
  home: string;
  workspaceRoot?: string;
  nodeModules: string[];
  writable: (dir: string) => Promise<boolean>;
};

const absoluteEnv = (env: Env, key: string): string | undefined => {
  const value = env[key];
  return value && isAbsolute(value) ? value : undefined;
};

export const expandHome = (path: string, home: string): string =>
  path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;

export const configPath = (context: Pick<DiscoveryContext, "env" | "home">): string => {
  const explicit = context.env.MCP_CLI_CONFIG;
  if (explicit) return expandHome(explicit, context.home);
  const base = absoluteEnv(context.env, "XDG_CONFIG_HOME") ?? join(context.home, ".config");
  return join(base, "mcp-cli", "config.json");
};

export const cacheDir = (
  context: Pick<DiscoveryContext, "env" | "home">,
  service: string,
): string => {
  const base = absoluteEnv(context.env, "XDG_CACHE_HOME") ?? join(context.home, ".cache");
  return join(base, "mcp-cli", service);
};

export const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

// Installed packages live under node_modules and get replaced on reinstall, so they never count as writable.
export const writableOutsideNodeModules = async (dir: string): Promise<boolean> =>
  !dir.split(sep).includes("node_modules") &&
  (await access(dir, constants.W_OK).then(
    () => true,
    () => false,
  ));

const ancestors = (start: string): string[] => {
  const chain = [start];
  for (let dir = dirname(start); dir !== chain.at(-1); dir = dirname(dir)) chain.push(dir);
  return chain;
};

const hasWorkspaces = async (dir: string): Promise<boolean> => {
  const file = Bun.file(join(dir, "package.json"));
  if (!(await file.exists())) return false;
  const pkg: unknown = await file.json().catch(() => undefined);
  return typeof pkg === "object" && pkg !== null && "workspaces" in pkg;
};

// Follows Node resolution order: node_modules beside each ancestor of the CLI package.
export const defaultContext = async (env: Env = process.env): Promise<DiscoveryContext> => {
  if (standalone() || bundledPlugins().length)
    return {
      env,
      home: env.HOME || homedir(),
      nodeModules: [],
      writable: async () => false,
    };
  const cliDir = fileURLToPath(new URL("..", import.meta.url)).replace(/[/\\]$/, "");
  const chain = ancestors(cliDir);
  const roots = await Promise.all(
    chain.map(async (dir) => ((await hasWorkspaces(dir)) ? dir : "")),
  );
  const nodeModules = chain.map((dir) => join(dir, "node_modules"));
  const present = await Promise.all(nodeModules.map(exists));
  return {
    env,
    home: env.HOME || homedir(),
    workspaceRoot: roots.find(Boolean),
    nodeModules: nodeModules.filter((_, i) => present[i]),
    writable: writableOutsideNodeModules,
  };
};
