#!/usr/bin/env bun
import { leadingArguments } from "./workspace-arguments";
import { RepeatedCallError, UsageError } from "@mcp-cli/core";
import { Cause, Effect, Exit } from "effect";
import { CliHost, printLine, processHost, type Host } from "./host";
import { ensureConfigDirectory } from "./config";
import { desktopCommand } from "./desktop";
import { authSettingsCommand } from "./auth-settings";
import { daemonCommand } from "./daemon/command";
import { resetDaemonIfRunning } from "./daemon/client";
import { runService } from "@mcp-cli/runtime";
import { defaultStore, loginCommand, logoutCommand, openInBrowser } from "./auth";
import { generate } from "./generate";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { pluginsCommand } from "./marketplace/entry";
import { defaultContext } from "./paths";
import { loadManifest } from "./plugins";
import { runtimeDependencies } from "./runtime";
import { workspaceCommand } from "./workspace-command";

export const EXIT = { ok: 0, failure: 1, usage: 2, repeated: 3 } as const;

const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: operation, catch: (error) => error });
// Runs a command module that has not moved onto CliHost yet.
const legacy = (operation: () => Promise<void>): Effect.Effect<number, unknown> =>
  Effect.as(attempt(operation), EXIT.ok);

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
    const { command, args } = leadingArguments(argv);
    const registry = async () => discover(await defaultContext(host.env));
    if (!command || ["--help", "-h", "help"].includes(command)) {
      const names = (yield* attempt(registry)).plugins.map((plugin) => plugin.service);
      yield* printLine(
        `${USAGE}\n\nServices:\n${names.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-cli <service> --help`,
      );
      return EXIT.ok;
    }
    if (command === "workspaces") return yield* legacy(() => workspaceCommand(args));
    if (command === "desktop") return yield* legacy(() => desktopCommand(args));
    if (command === "auth") return yield* legacy(() => authSettingsCommand(args));
    if (command === "daemon") return yield* Effect.as(daemonCommand(args), EXIT.ok);
    if (command === "generate") return yield* legacy(async () => generate(args, await registry()));
    if (command === "plugins") return yield* Effect.as(pluginsCommand(args), EXIT.ok);
    if (command === "login" || command === "logout") {
      const writeError = (text: string) => host.writeError(`${text}\n`);
      const run = command === "login" ? loginCommand : logoutCommand;
      return yield* legacy(async () => {
        await run(args, {
          env: host.env,
          store: defaultStore(host.env),
          plugin: async (name) => loadPlugin(findPlugin(await registry(), name)),
          writeError,
          open: openInBrowser(writeError),
          manual: host.onStdinLine,
          readSecret: host.readSecret,
        });
        await resetDaemonIfRunning(host.env);
      });
    }
    return yield* attempt(async () => {
      const discovered = await registry();
      const found = findPlugin(discovered, command);
      const plugin = await loadPlugin(found, discovered.context);
      const manifest = await loadManifest(discovered, found);
      return runService(plugin, manifest, args, runtimeDependencies(plugin));
    });
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
