import {
  UsageError,
  CallNotStartedError,
  applyCustomizations,
  type RepeatGuard,
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
import { createExecutor } from "./executor";
import { findExtension } from "./extensions";
import { compactDescription } from "./descriptions";
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
  readBytes(path: string): Promise<Uint8Array>;
  readStdin(): Promise<string>;
};
export type RuntimeDependencies = {
  /** `credential` names the plugin credential switch given for this run, if any. */
  open(credential?: string): Promise<ToolSession>;
  io: RuntimeIO;
  guard?: RepeatGuard;
  cacheScope?: (credential?: string) => Promise<string>;
  putBytes?: (url: string, bytes: Uint8Array) => Promise<void>;
};
export const runService = async (
  plugin: ServicePlugin,
  generated: GeneratedManifest,
  argv: string[],
  ports: RuntimeDependencies,
): Promise<number> => {
  const manifest = applyCustomizations(plugin, generated);
  const parsed = parseArguments(
    plugin.extensions?.normalizeArgv?.(argv) ?? argv,
    (commandPath) =>
      findCommand(manifest, commandPath)?.inputSchema ??
      findExtension(manifest, commandPath)?.inputSchema ??
      {},
    manifest.credentials.map((alternate) => alternate.flag),
  );
  const { path, tokens, json, wantsHelp, fullHelp, allowRepeat } = parsed;
  const credential = manifest.credentials.find((item) => item.flag === parsed.credential)?.base
    ? undefined
    : parsed.credential;
  // Every later connection, including resources and prompts, uses the chosen credential.
  let stdinRead = false;
  const dependencies = {
    ...ports,
    open: () => ports.open(credential),
    io: {
      ...ports.io,
      readStdin: async () => {
        if (stdinRead) throw new UsageError("stdin cannot be used by multiple inputs");
        stdinRead = true;
        return ports.io.readStdin();
      },
    },
  };
  if (path[0] === HELP) {
    if (tokens.length) throw new UsageError("Help does not accept input flags");
    dependencies.io.write(help(manifest, path.slice(1), { full: fullHelp }));
    return 0;
  }
  if (!path.length && tokens.length && !wantsHelp)
    throw new UsageError(`Missing command; run ${manifest.service} --help`);
  if (wantsHelp || !path.length) {
    dependencies.io.write(help(manifest, path, { full: fullHelp }));
    return 0;
  }
  if (path[0] === "schema") {
    if (tokens.length) throw new UsageError("Schema does not accept input flags");
    const requested = path.slice(1);
    const command =
      findCommand(manifest, requested) ??
      findExtension(manifest, requested) ??
      manifest.commands.find((item) => item.name === requested.join(" "));
    if (!command) throw new UsageError(`Unknown schema: ${requested.join(" ")}`);
    dependencies.io.write(
      JSON.stringify(
        {
          path: command.path,
          summary: command.summary,
          details: command.details,
          inputSchema: command.inputSchema,
        },
        null,
        2,
      ),
    );
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
      summary: compactDescription(command.summary ?? command.name),
    }));
    const extensions = (manifest.extensions ?? [])
      .filter((command) => path.slice(1).every((part, i) => command.path[i] === part))
      .map(({ path, summary, kind, tool }) => ({
        path,
        summary: compactDescription(summary),
        kind,
        tool,
      }));
    const entries = [...methods, ...extensions];
    dependencies.io.write(
      json
        ? JSON.stringify(entries, null, 2)
        : entries
            .map(
              (method) =>
                `${method.path.join(" ")}  ${method.tool ?? "workflow"}  ${method.summary}`,
            )
            .join("\n"),
    );
    return 0;
  }
  if (path.join(" ") === SKILL) {
    if (tokens.length) throw new UsageError("Skill does not accept input flags");
    dependencies.io.write(
      plugin.skill ??
        `Discovery: ${plugin.name} --help → <group> --help → <group> <action> --help.\n--help=full: server instructions, full JSON schemas.\nmethods --json: baked-in tool map.\nComplex schemas: --input.\nHelp/discovery: no server connection.\nresources, prompts: fetch from server at runtime.`,
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
  const extension = findExtension(manifest, path);
  const command = findCommand(manifest, path);
  if (!command && !extension) {
    if (tokens.length) throw new UsageError(`Unknown command: ${path.join(" ")}`);
    dependencies.io.write(help(manifest, path));
    return 0;
  }
  const schema = extension?.inputSchema ?? command?.inputSchema ?? {};
  const input = await parseInput(tokens, schema, dependencies.io);
  if (extension) validateUserInput(schema, input);
  const executor = createExecutor(plugin, manifest, dependencies, { allowRepeat, credential });
  try {
    const outcome = extension
      ? await extension.run(input, {
          callTool: executor.callWorkflowTool,
          io: dependencies.io,
          json,
          credential,
          runCommand: async (args) => {
            const output: string[] = [];
            const exitCode = await runService(
              plugin,
              generated,
              credential &&
                !args.some((arg) => manifest.credentials.some((item) => arg === `--${item.flag}`))
                ? [`--${credential}`, ...args]
                : args,
              {
                ...ports,
                io: {
                  ...dependencies.io,
                  write: (value) => output.push(value),
                  writeError: (value) => output.push(value),
                },
              },
            );
            return { exitCode, output };
          },
          cacheScope: await dependencies.cacheScope?.(credential),
        })
      : { result: await executor.callTool(command?.name ?? "", input) };
    const text = formatResult(outcome.result, json);
    if (outcome.result.isError && !json) dependencies.io.writeError(text);
    else dependencies.io.write(text);
    return outcome.exitCode ?? (outcome.result.isError ? 1 : 0);
  } catch (error) {
    if (error instanceof CallNotStartedError) throw error.cause;
    throw error;
  } finally {
    await executor.close();
  }
};
