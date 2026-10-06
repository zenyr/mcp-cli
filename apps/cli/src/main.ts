#!/usr/bin/env bun
import { UsageError } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { runService } from "@mcp-cli/runtime";
import {
  defaultStore,
  loginCommand,
  logoutCommand,
  openInBrowser,
  resolveConnection,
} from "./auth";
import { generate } from "./generate";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { listPlugins } from "./list";
import { defaultContext } from "./paths";
import { loadManifest } from "./plugins";

export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

export const main = async (argv: string[]): Promise<number> => {
  const [command, ...args] = argv;
  const registry = async () => discover(await defaultContext());
  if (!command || ["--help", "-h", "help"].includes(command)) {
    const serviceNames = (await registry()).plugins.map((plugin) => plugin.service);
    console.log(
      `Usage: mcp-cli <service> <command>\n       mcp-cli generate <service> [--snapshot <path>] [--check]\n       mcp-cli plugins\n\nServices:\n${serviceNames.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-cli <service> --help`,
    );
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
    });
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
    open: async () => connect(await resolveConnection(plugin, process.env, defaultStore())),
    io: {
      write: (text) => console.log(text),
      writeError: (text) => console.error(text),
      readFile: (path) => Bun.file(path).text(),
      readStdin: () => Bun.stdin.text(),
    },
  });
};

export const exitCodeFor = (error: unknown): number =>
  error instanceof UsageError ? EXIT.usage : EXIT.failure;

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeFor(error);
  }
}
