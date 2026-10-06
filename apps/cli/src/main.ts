#!/usr/bin/env bun
import type { Manifest } from "@mcp-to-cli/core";
import { connect } from "@mcp-to-cli/mcp";
import { runService } from "@mcp-to-cli/runtime";
import { generate } from "./generate";
import { generatedPath, loadPlugin, serviceNames } from "./plugins";

export const main = async (argv: string[]): Promise<number> => {
  const [command, ...args] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) {
    console.log(
      `Usage: mcp-to-cli <service> <command>\n       mcp-to-cli generate <service> [--snapshot <path>] [--check]\n\nServices:\n${serviceNames.map((name) => `  ${name}`).join("\n")}\n\nNext: mcp-to-cli <service> --help`,
    );
    return 0;
  }
  if (command === "generate") {
    await generate(args);
    return 0;
  }
  const plugin = await loadPlugin(command);
  const path = generatedPath(plugin.name);
  if (!(await Bun.file(path).exists()))
    throw new Error(`Run mcp-to-cli generate ${plugin.name} first`);
  const { manifest } = (await import(path)) as { manifest: Manifest };
  return runService(plugin, manifest, args, {
    open: () => connect(plugin.connection(process.env)),
    io: {
      write: (text) => console.log(text),
      readFile: (path) => Bun.file(path).text(),
      readStdin: () => Bun.stdin.text(),
    },
  });
};
if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
