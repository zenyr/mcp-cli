import { UsageError, type ToolSession } from "@mcp-cli/core";
import type { InputToken } from "./arguments";

/** Parsed argv after the `resources` or `prompts` command word. */
export type CatalogRequest = {
  service: string;
  path: string[];
  tokens: InputToken[];
  json: boolean;
};
export type CatalogDependencies = {
  open(): Promise<ToolSession>;
  io: {
    write(text: string): void;
    readFile(path: string): Promise<string>;
    readStdin(): Promise<string>;
  };
};

export const rejectFlags = (request: CatalogRequest, command: string): void => {
  if (request.tokens.length) throw new UsageError(`${command} does not accept input flags`);
};

// Exactly `count` positional operands follow the subcommand.
export const operands = (request: CatalogRequest, usage: string, count: number): string[] => {
  const rest = request.path.slice(1);
  if (rest.length !== count) throw new UsageError(`Usage: ${request.service} ${usage}`);
  return rest;
};

export const withSession = async <T>(
  dependencies: CatalogDependencies,
  run: (session: ToolSession) => Promise<T>,
): Promise<T> => {
  const session = await dependencies.open();
  try {
    return await run(session);
  } finally {
    await session.close();
  }
};

export const unknownSubcommand = (request: CatalogRequest, group: string): UsageError =>
  new UsageError(
    `Unknown command: ${[group, ...request.path].join(" ")}; run ${request.service} ${group} --help`,
  );
