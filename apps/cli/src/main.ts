#!/usr/bin/env bun
import { UsageError } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { runService } from "@mcp-cli/runtime";
import { generate } from "./generate";
import { loadManifest, loadPlugin, serviceNames } from "./plugins";

export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

export const main = async (argv: string[]): Promise<number> => {
  const [command, ...args] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) {
    console.log(
      `Usage: mcp-cli <service> <command>\n       mcp-cli generate <service> [--snapshot <path>] [--check]\n\nServices:\n${serviceNames.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-cli <service> --help`,
    );
    return EXIT.ok;
  }
  if (command === "generate") {
    await generate(args);
    return EXIT.ok;
  }
  const plugin = await loadPlugin(command);
  const manifest = await loadManifest(plugin.name);
  return runService(plugin, manifest, args, {
    open: async () => connect(await plugin.connection(process.env)),
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
