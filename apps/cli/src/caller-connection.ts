import type { Connection, ServicePlugin } from "@mcp-cli/core";
import type { Env } from "./host";
import { workspaceEnvironment } from "./plugin-credentials";

/** The calling shell's environment and directory that a stdio server inherits. */
export type Caller = { env: Env; cwd: string };

/** Starts stdio servers in the caller's directory with the workspace-filtered caller env under the plugin env, or the plugin env alone when isolated. */
export const callerConnection = (
  config: Connection,
  caller: Caller,
  plugin: ServicePlugin,
): Connection => {
  if (config.type !== "stdio") return config;
  const inherited = Object.fromEntries(
    Object.entries(workspaceEnvironment(plugin, caller.env)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...config,
    cwd: config.cwd ?? caller.cwd,
    env: config.isolatedEnv ? config.env : { ...inherited, ...config.env },
  };
};
