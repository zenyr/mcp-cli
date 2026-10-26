#!/usr/bin/env bun
import { RepeatedCallError, UsageError } from "@mcp-cli/core";
import { ensureConfigDirectory } from "./config";
import { desktopCommand } from "./desktop";
import { authSettingsCommand } from "./auth-settings";
import { daemonCommand } from "./daemon/command";
import {
  resetDaemonIfRunning,
  openDaemonSession,
  usesDaemon,
  DaemonUnavailableError,
} from "./daemon/client";
import { connect } from "@mcp-cli/mcp";
import { runService } from "@mcp-cli/runtime";
import {
  defaultStore,
  loginCommand,
  logoutCommand,
  openInBrowser,
  resolveConnection,
  stdinRedirects,
} from "./auth";
import { generate } from "./generate";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { listPlugins } from "./list";
import { defaultContext } from "./paths";
import { loadManifest } from "./plugins";
import { defaultRepeatGuard } from "./repeat";
import { readSecret } from "./secret";
import { putBytes } from "./transfer";
import { extensionCacheScope } from "./cache-scope";

export const EXIT = { ok: 0, failure: 1, usage: 2, repeated: 3 } as const;

export const main = async (argv: string[]): Promise<number> => {
  await ensureConfigDirectory();
  const [command, ...args] = argv;
  const registry = async () => discover(await defaultContext());
  if (!command || ["--help", "-h", "help"].includes(command)) {
    const serviceNames = (await registry()).plugins.map((plugin) => plugin.service);
    console.log(
      `Usage: mcp-cli <service> <command>\n       mcp-cli generate <service> [--snapshot <path>] [--check]\n       mcp-cli plugins\n       mcp-cli daemon <start|status|reset|stop>\n       mcp-cli login <service> [--no-browser]\n       mcp-cli logout <service>\n       mcp-cli auth <configure|status> <service> [--check]\n\nServices:\n${serviceNames.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-cli <service> --help`,
    );
    return EXIT.ok;
  }
  if (command === "desktop") {
    await desktopCommand(args);
    return EXIT.ok;
  }
  if (command === "auth") {
    await authSettingsCommand(args);
    return EXIT.ok;
  }
  if (command === "daemon") {
    await daemonCommand(args);
    return EXIT.ok;
  }
  if (command === "generate") {
    await generate(args, await registry());
    return EXIT.ok;
  }
  if (command === "login" || command === "logout") {
    const writeError = (text: string) => console.error(text);
    const run = command === "login" ? loginCommand : logoutCommand;
    await run(args, {
      env: process.env,
      store: defaultStore(),
      plugin: async (name) => loadPlugin(findPlugin(await registry(), name)),
      writeError,
      open: openInBrowser(writeError),
      manual: stdinRedirects,
      readSecret,
    });
    await resetDaemonIfRunning();
    return EXIT.ok;
  }
  if (command === "plugins") {
    console.log(await listPlugins(await registry(), args));
    return EXIT.ok;
  }
  const discovered = await registry();
  const found = findPlugin(discovered, command);
  const plugin = await loadPlugin(found);
  const manifest = await loadManifest(discovered, found);
  return runService(plugin, manifest, args, {
    open: async (credential) => {
      if (usesDaemon()) {
        try {
          return await openDaemonSession(plugin.name, credential);
        } catch (error) {
          if (!(error instanceof DaemonUnavailableError)) throw error;
        }
      }
      return connect(await resolveConnection(plugin, process.env, defaultStore(), credential));
    },
    guard: defaultRepeatGuard(process.env),
    cacheScope: (credential) =>
      extensionCacheScope(plugin, process.env, defaultStore(), credential),
    putBytes,
    io: {
      write: (text) => console.log(text),
      writeError: (text) => console.error(text),
      readFile: (path) => Bun.file(path).text(),
      readStdin: () => Bun.stdin.text(),
      readBytes: (path) => Bun.file(path).bytes(),
    },
  });
};

export const exitCodeFor = (error: unknown): number =>
  error instanceof UsageError
    ? EXIT.usage
    : error instanceof RepeatedCallError
      ? EXIT.repeated
      : EXIT.failure;

export const run = async (argv: string[]): Promise<void> => {
  try {
    process.exitCode = await main(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeFor(error);
  }
};

if (import.meta.main) await run(process.argv.slice(2));
