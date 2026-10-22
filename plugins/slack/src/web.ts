import {
  UsageError,
  type ExtensionCommand,
  type ExtensionContext,
  type ToolResult,
} from "@mcp-cli/core";
import { call, output, requireId, SlackFailure, target, text, type Input } from "./web-common";
import { channels, usergroups, users } from "./web-directory";
import { messages } from "./web-messages";
import { checkStdin, jsonSource, requireAttachment, validateBlocks } from "./web-payload";
import { normalizeArgv, positional, splitCommand } from "./web-argv";
import { specs, schemaFor, type WebSpec } from "./web-specs";

const batch = async (
  input: Input,
  context: ExtensionContext,
): Promise<{ result: ToolResult; exitCode: number }> => {
  const commands = Array.isArray(input.commands) ? input.commands.map(String) : [];
  if (!commands.length || commands.length > 50)
    throw new UsageError("Batch requires 1 to 50 commands");
  const parsed = commands.map(splitCommand);
  for (const args of parsed) {
    if (normalizeArgv(args)[0] === "batch") throw new UsageError("Nested batch is forbidden");
  }
  if (!context.runCommand) throw new UsageError("Batch is unavailable in this runtime");
  const items: Input[] = [];
  for (const [index, args] of parsed.entries()) {
    const start = performance.now();
    try {
      const result = await context.runCommand(["--json", ...args]);
      items.push({
        index,
        command: commands[index],
        ...result,
        elapsed_ms: Math.round(performance.now() - start),
      });
      if (result.exitCode && input["stop-on-error"] !== false) break;
    } catch (error) {
      items.push({
        index,
        command: commands[index],
        exitCode: error instanceof UsageError ? 2 : 1,
        error: error instanceof Error ? error.message : "Command failed",
        elapsed_ms: Math.round(performance.now() - start),
      });
      if (input["stop-on-error"] !== false) break;
    }
  }
  const failed = items.some((item) => item.exitCode !== 0);
  return {
    result: output({ items, partial: items.length !== commands.length, failed }),
    exitCode: failed && input["fail-on-error"] !== false ? 1 : 0,
  };
};
const execute = async (entry: WebSpec, input: Input, context: ExtensionContext): Promise<Input> => {
  const { path } = entry;
  if (path.startsWith("channels ")) return channels(path, input, context);
  if (path.startsWith("users ")) return users(path, input, context);
  if (path.startsWith("messages ")) return messages(path, input, context);
  if (path.startsWith("usergroups ")) return usergroups(path, input, context);
  if (path.startsWith("reactions ")) {
    const ref = await target(context, input);
    const name = text(input, "emoji").replace(/^:|:$/g, "");
    if (path !== "reactions list" && !/^[a-zA-Z0-9_+-]+$/.test(name))
      throw new UsageError("Invalid emoji name");
    return call(context, entry.method, {
      channel: ref.channel,
      timestamp: ref.ts,
      ...(path !== "reactions list" && { name }),
    });
  }
  if (path === "attachment get") {
    requireAttachment();
    if (input.content === true && input.save === true)
      throw new UsageError("--content and --save are mutually exclusive");
    const metadata = await call(context, "files.info", {
      file: requireId(text(input, "file"), "file"),
    });
    if (input.content !== true && input.save !== true) return metadata;
    const file = metadata.file;
    if (
      typeof file !== "object" ||
      file === null ||
      !("url_private_download" in file || "url_private" in file)
    )
      throw new UsageError("File has no authenticated download URL");
    const url =
      "url_private_download" in file
        ? file.url_private_download
        : "url_private" in file
          ? file.url_private
          : undefined;
    return {
      metadata,
      download: await call(context, "download", { url, save: input.save === true }),
    };
  }
  if (path.startsWith("views ")) {
    const user_id = requireId(text(input, "user"), "user");
    const view =
      path === "views clear"
        ? { type: "home", blocks: [] }
        : await jsonSource(text(input, "view"), context);
    if (
      typeof view !== "object" ||
      view === null ||
      !("type" in view) ||
      view.type !== "home" ||
      !("blocks" in view)
    )
      throw new UsageError("view must be a home view with blocks");
    validateBlocks(view.blocks, 100);
    const hash = text(input, "hash");
    return call(context, "views.publish", { user_id, view, ...(hash && { hash }) });
  }
  if (path.startsWith("auth ")) return call(context, "auth.test");
  throw new UsageError("Unsupported command");
};
const command = (entry: WebSpec): ExtensionCommand => ({
  path: entry.path.split(" "),
  kind: "workflow",
  summary: `${entry.method} · ${entry.write ? "write" : "read-only"}`,
  details: [
    entry.details,
    `Route: Web API. Arguments: ${entry.args.join(" ") || "none"}.`,
    entry.path.startsWith("messages ") &&
    ["messages post", "messages reply", "messages update"].includes(entry.path)
      ? "--blocks [JSON|true|-] converts Markdown or reads JSON. Blocks-only posts derive fallback text from text elements; otherwise supply text. --payload JSON|-|@file reads a request. --dry-run validates without a write. --payload-out creates a reusable request file. Omitted update fields stay unchanged; empty arrays/text clear them."
      : "",
  ]
    .filter(Boolean)
    .join("\n"),
  inputSchema: schemaFor(entry),
  run: async (raw, context) => {
    const input = positional(entry, raw);
    checkStdin(input);
    if (entry.path === "batch") return batch(input, context);
    try {
      return { result: output(await execute(entry, input, context)) };
    } catch (error) {
      if (error instanceof SlackFailure) return { result: error.result };
      throw error;
    }
  },
});
export const webExtensions = { commands: specs.map(command), normalizeArgv };
