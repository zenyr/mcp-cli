import {
  UsageError,
  applyCustomizations,
  type GeneratedManifest,
  type JsonSchema,
  type ServicePlugin,
  type ToolResult,
  type ToolSession,
} from "@mcp-cli/core";
import { InputValidationError, validateInput } from "@mcp-cli/schema";
import { findCommand, help } from "./help";
import { parseInput } from "./input";
import { parseArguments } from "./arguments";
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
// Only input that fails validation is a usage problem; a broken schema propagates unchanged.
const validateUserInput = (schema: JsonSchema, input: Record<string, unknown>): void => {
  try {
    validateInput(schema, input);
  } catch (error) {
    if (error instanceof InputValidationError)
      throw new UsageError(error.message, { cause: error });
    throw error;
  }
};

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
  if (path[0] === "help") {
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
  if (path[0] === "methods") {
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
  if (path.join(" ") === "skill") {
    if (tokens.length) throw new UsageError("Skill does not accept input flags");
    dependencies.io.write(
      plugin.skill ??
        `Start with ${plugin.name} --help, then <group> --help, then <group> <action> --help.\nUse methods --json for the baked-in tool map.\nUse --input for complex schemas.\nHelp and discovery never connect to the server.`,
    );
    return 0;
  }
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
    if (result.isError) dependencies.io.writeError(text);
    else dependencies.io.write(text);
    return result.isError ? 1 : 0;
  } finally {
    await session.close();
  }
};
