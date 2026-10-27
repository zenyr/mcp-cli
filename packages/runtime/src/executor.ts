import { randomUUID } from "node:crypto";
import {
  RepeatedCallError,
  CallNotStartedError,
  UsageError,
  isRecord,
  type Manifest,
  type ServicePlugin,
  type ToolCaller,
  type ToolSession,
  type ToolResult,
} from "@mcp-cli/core";
import type { RuntimeDependencies } from "./index";
import { validateUserInput } from "./input";
import { callKey, guardsRepeats, repeatMessage } from "./repeat";
import { preUploadSchema, readLocalFiles, uploadLocalFiles, withDigests } from "./uploads";

class PreparationError extends Error {}

export const createExecutor = (
  plugin: ServicePlugin,
  manifest: Manifest,
  dependencies: RuntimeDependencies,
  options: { allowRepeat: boolean; credential?: string },
) => {
  let session: Promise<ToolSession> | undefined;
  const open = (): Promise<ToolSession> => {
    session ??= dependencies.open();
    return session;
  };
  const markUnstarted = (error: unknown): never => {
    if (error instanceof PreparationError) throw error;
    throw new PreparationError(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  };
  const invoke = async (
    name: string,
    input: Record<string, unknown>,
    scope?: string,
  ): Promise<ToolResult> => {
    const prepare = async () => {
      const command = manifest.commands.find((item) => item.name === name);
      if (!command) throw new UsageError(`Unknown tool: ${name}`);
      const files = await readLocalFiles(command, input, dependencies.io.readBytes);
      validateUserInput(files.size ? preUploadSchema(command) : command.inputSchema, input);
      await plugin.beforeCall?.(command, input);
      const { uploadFile } = plugin;
      const { putBytes } = dependencies;
      if (files.size && (!uploadFile || !putBytes))
        throw new Error(`${manifest.service} cannot upload local files in this environment`);
      const guard = options.allowRepeat || !guardsRepeats(command) ? undefined : dependencies.guard;
      const normalized = withDigests(command, input, files);
      const key = callKey(
        command.name,
        scope ? { input: normalized, uploadScope: scope } : normalized,
        options.credential,
        dependencies.workspaceId,
      );
      const attempt = randomUUID();
      const earlier = await guard?.begin(manifest.service, key, command.name, attempt);
      if (earlier)
        throw new RepeatedCallError(repeatMessage(command.path.join(" "), earlier, Date.now()));
      const notRun = async (error: unknown): Promise<never> => {
        await guard?.finish(manifest.service, key, attempt, "error");
        throw error;
      };
      const connected = await open().catch(notRun);
      const payload =
        files.size && uploadFile && putBytes
          ? await uploadLocalFiles(command, input, files, (file) =>
              uploadFile(file, {
                callTool: (tool, payload) =>
                  invoke(
                    tool,
                    payload,
                    `${key}:${attempt}:${files.get(`@${file.path}`)?.digest ?? file.path}`,
                  ),
                putBytes,
              }),
            )
              .then((uploaded) => {
                validateUserInput(command.inputSchema, uploaded);
                return uploaded;
              })
              .catch(notRun)
          : input;
      return { connected, payload, command, guard, key, attempt };
    };
    const { connected, payload, command, guard, key, attempt } =
      await prepare().catch(markUnstarted);
    const result = await connected.callTool(command.name, payload);
    // A thrown call stays pending because the server may still have applied it.
    const uncertain =
      isRecord(result.structuredContent) && result.structuredContent.outcome === "unknown";
    if (!uncertain)
      await guard?.finish(manifest.service, key, attempt, result.isError ? "error" : "ok");
    return result;
  };
  const callTool: ToolCaller = async (name, input) => {
    try {
      return await invoke(name, input);
    } catch (error) {
      if (error instanceof PreparationError) throw error.cause;
      throw error;
    }
  };
  const callWorkflowTool: ToolCaller = async (name, input) => {
    try {
      return await invoke(name, input);
    } catch (error) {
      if (error instanceof PreparationError)
        throw new CallNotStartedError(error.message, { cause: error.cause });
      throw error;
    }
  };
  const close = async (): Promise<void> => {
    if (!session) return;
    const connected = await session.catch(() => undefined);
    await connected?.close();
  };
  return { callTool, callWorkflowTool, close };
};
