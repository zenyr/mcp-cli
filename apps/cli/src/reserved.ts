import { UsageError } from "@mcp-cli/core";

/** Top-level CLI commands that `main` routes before any service. */
export const TOP_LEVEL_COMMANDS = [
  "help",
  "generate",
  "plugins",
  "workspaces",
  "login",
  "logout",
  "auth",
  "desktop",
  "daemon",
] as const;
export type TopLevelCommand = (typeof TOP_LEVEL_COMMANDS)[number];

/** Names a service may not use: top-level commands plus the launcher's own command name. */
export const RESERVED_SERVICES: readonly string[] = [...TOP_LEVEL_COMMANDS, "mcp-cli"];

export const isReservedService = (service: string): boolean => RESERVED_SERVICES.includes(service);

export const assertUnreserved = (service: string): void => {
  if (isReservedService(service)) throw new UsageError(`Reserved command name: ${service}`);
};
