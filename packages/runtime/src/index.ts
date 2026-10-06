import { randomUUID } from "node:crypto";
import {
  RepeatedCallError,
  UsageError,
  applyCustomizations,
  type LocalFile,
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
import { callKey, guardsRepeats, repeatMessage } from "./repeat";
import { preUploadSchema, readLocalFiles, uploadLocalFiles, withDigests } from "./uploads";
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
  open(): Promise<ToolSession>;
  io: RuntimeIO;
  guard?: RepeatGuard;
  putBytes?: (url: string, bytes: Uint8Array) => Promise<void>;
};
export const runService = async (
  plugin: ServicePlugin,
  generated: GeneratedManifest,
  argv: string[],
  dependencies: RuntimeDependencies,
): Promise<number> => {
  const manifest = applyCustomizations(plugin, generated);
  const { path, tokens, json, wantsHelp, allowRepeat } = parseArguments(
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
  const files = await readLocalFiles(command, input, dependencies.io.readBytes);
  validateUserInput(files.size ? preUploadSchema(command) : command.inputSchema, input);
  await plugin.beforeCall?.(command, input);
  const { uploadFile } = plugin;
  const { putBytes } = dependencies;
  if (files.size && (!uploadFile || !putBytes))
    throw new Error(`${manifest.service} cannot upload local files in this environment`);
  const guard = allowRepeat || !guardsRepeats(command) ? undefined : dependencies.guard;
  const key = callKey(command.name, withDigests(command, input, files));
  const attempt = randomUUID();
  const earlier = await guard?.begin(manifest.service, key, command.name, attempt);
  if (earlier)
    throw new RepeatedCallError(repeatMessage(command.path.join(" "), earlier, Date.now()));
  // Failures before the tool call prove it never ran, so they must not block the retry.
  const notRun = async (error: unknown): Promise<never> => {
    await guard?.finish(manifest.service, key, attempt, "error");
    throw error;
  };
  const session = await dependencies.open().catch(notRun);
  try {
    const upload =
      files.size && uploadFile && putBytes
        ? (file: LocalFile) => uploadFile(file, { callTool: session.callTool, putBytes })
        : undefined;
    const payload = upload
      ? await uploadLocalFiles(command, input, files, upload)
          .then((uploaded) => {
            validateUserInput(command.inputSchema, uploaded);
            return uploaded;
          })
          .catch(notRun)
      : input;
    const result = await session.callTool(command.name, payload);
    // A thrown call stays pending because the server may still have applied it.
    await guard?.finish(manifest.service, key, attempt, result.isError ? "error" : "ok");
    const text = formatResult(result, json);
    // With --json the structured result stays on stdout so pipes see it; the exit code marks the error.
    if (result.isError && !json) dependencies.io.writeError(text);
    else dependencies.io.write(text);
    return result.isError ? 1 : 0;
  } finally {
    await session.close();
  }
};
