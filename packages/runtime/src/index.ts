import {
  UsageError,
  applyCustomizations,
  type GeneratedManifest,
  type ServicePlugin,
  type ToolResult,
  type ToolSession,
} from "@mcp-cli/core";
import { findCommand, help } from "./help";
import { parseInput, validateUserInput } from "./input";
import { parseArguments } from "./arguments";
import { runPrompts } from "./prompts";
import { HELP, METHODS, PROMPTS, RESOURCES, SKILL } from "./reserved";
import { runResources } from "./resources";
export { help } from "./help";

const formatResult = (result: ToolResult, json: boolean): string =>
  json
    ? JSON.stringify(result, null, 2)
    : result.content
        .map((block) =>
          block.type === "text" && typeof block.text === "string"
            ? block.text
            : JSON.stringify(block),
        )
        .join("\n");

export type RuntimeIO = {
  write(text: string): void;
  writeError(text: string): void;
  readFile(path: string): Promise<string>;
  readStdin(): Promise<string>;
};
export const runService = async (
  plugin: ServicePlugin,
  generated: GeneratedManifest,
  argv: string[],
  dependencies: { open(): Promise<ToolSession>; io: RuntimeIO },
): Promise<number> => {
  const manifest = applyCustomizations(plugin, generated);
  const { path, tokens, json, wantsHelp } = parseArguments(
    argv,
    (commandPath) => findCommand(manifest, commandPath)?.inputSchema ?? {},
  );
  if (path[0] === HELP) {
    if (tokens.length) throw new UsageError("Help does not accept input flags");
    dependencies.io.write(help(manifest, path.slice(1)));
    return 0;
  }
  if (!path.length && tokens.length && !wantsHelp)
    throw new UsageError(`Missing command; run ${manifest.service} --help`);
  if (wantsHelp || !path.length) {
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  if (path[0] === METHODS) {
    if (tokens.length) throw new UsageError("Methods does not accept input flags");
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
  if (path.join(" ") === SKILL) {
    if (tokens.length) throw new UsageError("Skill does not accept input flags");
    dependencies.io.write(
      plugin.skill ??
        `Start with ${plugin.name} --help, then <group> --help, then <group> <action> --help.\nUse methods --json for the baked-in tool map.\nUse --input for complex schemas.\nHelp and discovery never connect to the server.\nresources and prompts commands fetch from the server at run time.`,
    );
    return 0;
  }
  const catalog = { path: path.slice(1), tokens, json, service: manifest.service };
  if ((path[0] === RESOURCES || path[0] === PROMPTS) && path.length === 1 && !tokens.length) {
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  if (path[0] === RESOURCES) return runResources(catalog, dependencies);
  if (path[0] === PROMPTS) return runPrompts(catalog, dependencies);
  const command = findCommand(manifest, path);
  if (!command) {
    if (tokens.length) throw new UsageError(`Unknown command: ${path.join(" ")}`);
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  const input = await parseInput(tokens, command.inputSchema, dependencies.io);
  validateUserInput(command.inputSchema, input);
  await plugin.beforeCall?.(command, input);
  const session = await dependencies.open();
  try {
    const result = await session.callTool(command.name, input);
    const text = formatResult(result, json);
    // With --json the structured result stays on stdout so pipes see it; the exit code marks the error.
    if (result.isError && !json) dependencies.io.writeError(text);
    else dependencies.io.write(text);
    return result.isError ? 1 : 0;
  } finally {
    await session.close();
  }
};
