import type { Manifest, ServicePlugin, ToolSession } from "@mcp-to-cli/core";
import { validateInput } from "@mcp-to-cli/schema";
import { findCommand, help } from "./help";
import { parseInput } from "./input";
import { parseArguments } from "./arguments";
export { help } from "./help";

export type RuntimeIO = {
  write(text: string): void;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
};
export const runService = async (
  plugin: ServicePlugin,
  manifest: Manifest,
  argv: string[],
  dependencies: { open(): Promise<ToolSession>; io: RuntimeIO },
): Promise<number> => {
  if (manifest.service !== plugin.name || manifest.version !== 1)
    throw new Error("Plugin and manifest do not match");
  const initial = parseArguments(argv);
  const selected = findCommand(manifest, initial.path);
  const { path, args, json, wantsHelp } = parseArguments(argv, selected?.inputSchema);
  if (path[0] === "help") {
    if (args.length) throw new Error("Help does not accept input flags");
    dependencies.io.write(help(manifest, path.slice(1)));
    return 0;
  }
  if (wantsHelp || !path.length) {
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  if (path[0] === "methods") {
    if (args.length) throw new Error("Methods does not accept input flags");
    const commands = manifest.commands.filter((command) =>
      path.slice(1).every((part, i) => command.path[i] === part),
    );
    const methods = commands.map((command) => ({
      tool: command.name,
      path: command.path,
      summary: command.summary,
    }));
    dependencies.io.write(
      json
        ? JSON.stringify(methods, null, 2)
        : methods
            .map((method) => `${method.path.join(" ")}  ${method.tool}  ${method.summary}`)
            .join("\n"),
    );
    return 0;
  }
  if (path.join(" ") === "skill") {
    if (args.length) throw new Error("Skill does not accept input flags");
    dependencies.io.write(
      plugin.skill ??
        `Start with ${plugin.name} --help, then <group> --help, then <group> <action> --help.\nUse methods --json for the baked-in tool map.\nUse --input for complex schemas.\nHelp and discovery never connect to the server.`,
    );
    return 0;
  }
  const command = findCommand(manifest, path);
  if (!command) {
    if (args.length) throw new Error(`Unknown command: ${path.join(" ")}`);
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  const input = await parseInput(args, command.inputSchema, dependencies.io);
  validateInput(command.inputSchema, input);
  await plugin.beforeCall?.(command, input);
  const session = await dependencies.open();
  try {
    const result = await session.callTool(command.name, input);
    dependencies.io.write(
      json
        ? JSON.stringify(result, null, 2)
        : result.content
            .map((block) =>
              block.type === "text" && typeof block.text === "string"
                ? block.text
                : JSON.stringify(block),
            )
            .join("\n"),
    );
    return result.isError ? 1 : 0;
  } finally {
    await session.close();
  }
};
