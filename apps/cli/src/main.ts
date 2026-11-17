#!/usr/bin/env bun
import { leadingArguments } from "./workspace-arguments";
import { RepeatedCallError, UsageError } from "@mcp-cli/core";
import { Cause, Effect, Exit } from "effect";
import { attempt, attemptSync } from "./attempt";
import { CliHost, printLine, processHost, type Host } from "./host";
import { ensureConfigDirectory } from "./config";
import { desktopCommand } from "./desktop";
import { authSettingsCommand } from "./auth-settings";
import { daemonCommand } from "./daemon/command";
import { generateCommand } from "./generate";
import { discover } from "./discovery";
import { credentialCommand } from "./login-command";
import { pluginsCommand } from "./marketplace/entry";
import { defaultContext } from "./paths";
import { serviceCommand } from "./runtime";
import { workspaceCommand } from "./workspace-command";

export const EXIT = { ok: 0, failure: 1, usage: 2, repeated: 3 } as const;

const USAGE = `Usage: mcp-cli <service> <command>
       mcp-cli generate <service> [--snapshot <path>] [--check]
       mcp-cli plugins
       mcp-cli workspaces <list|add|rename|default> <service>
       mcp-cli daemon <start|status|reset|stop>
       mcp-cli login <service> [--no-browser]
       mcp-cli logout <service>
       mcp-cli auth <configure|status> <service> [--check]`;

export const main = (argv: string[]): Effect.Effect<number, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    yield* attempt(() => ensureConfigDirectory(host.env));
    const { command, args } = yield* attemptSync(() => leadingArguments(argv));
    const registry = async () => discover(await defaultContext(host.env));
    if (!command || ["--help", "-h", "help"].includes(command)) {
      const names = (yield* attempt(registry)).plugins.map((plugin) => plugin.service);
      yield* printLine(
        `${USAGE}\n\nServices:\n${names.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-cli <service> --help`,
      );
      return EXIT.ok;
    }
    if (command === "workspaces") return yield* Effect.as(workspaceCommand(args), EXIT.ok);
    if (command === "desktop") return yield* Effect.as(desktopCommand(args), EXIT.ok);
    if (command === "auth") return yield* Effect.as(authSettingsCommand(args), EXIT.ok);
    if (command === "daemon") return yield* Effect.as(daemonCommand(args), EXIT.ok);
    if (command === "generate") return yield* Effect.as(generateCommand(args), EXIT.ok);
    if (command === "plugins") return yield* Effect.as(pluginsCommand(args), EXIT.ok);
    if (command === "login" || command === "logout")
      return yield* Effect.as(credentialCommand(command, args), EXIT.ok);
    return yield* serviceCommand(command, args);
  });

export const exitCodeFor = (error: unknown): number =>
  error instanceof UsageError
    ? EXIT.usage
    : error instanceof RepeatedCallError
      ? EXIT.repeated
      : EXIT.failure;

/** Runs the CLI against a host and returns the exit status; the only place a failure Cause is rendered. */
export const execute = async (argv: string[], host: Host): Promise<number> => {
  const exit = await Effect.runPromiseExit(Effect.provideService(main(argv), CliHost, host));
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  host.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
  return exitCodeFor(error);
};

export const run = async (argv: string[]): Promise<void> => {
  process.exitCode = await execute(argv, processHost);
};

if (import.meta.main) await run(process.argv.slice(2));
