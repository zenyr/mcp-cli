import { writeFile } from "node:fs/promises";
import { isRecord, UsageError, type ExtensionContext } from "@mcp-cli/core";
import { channel, type Input } from "./web-common";

export const jsonSource = async (value: string, context: ExtensionContext): Promise<unknown> => {
  const source =
    value === "-"
      ? await context.io.readStdin()
      : value.startsWith("@")
        ? await context.io.readFile(value.slice(1))
        : value;
  try {
    return JSON.parse(source);
  } catch {
    throw new UsageError("Invalid JSON input");
  }
};
export const validateBlocks = (value: unknown, maximum = 50): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new UsageError(`blocks must be an array with at most ${maximum} entries`);
  for (const block of value) {
    if (!isRecord(block) || typeof block.type !== "string")
      throw new UsageError("Every block requires a type");
    if (
      isRecord(block.text) &&
      typeof block.text.text === "string" &&
      block.text.text.length > (block.type === "header" ? 150 : 3000)
    )
      throw new UsageError("Block text exceeds Slack's length limit");
    if (Array.isArray(block.fields) && block.fields.length > 10)
      throw new UsageError("A section has at most 10 fields");
    if (Array.isArray(block.elements) && block.type === "actions" && block.elements.length > 25)
      throw new UsageError("An actions block has at most 25 elements");
  }
  return value;
};
const escapeMarkup = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const markdown = (value: string): string =>
  value
    .split(/(```[\s\S]*?```|`[^`\n]*`|\*\*[^*]+\*\*|__[^_]+__)/g)
    .map((part) => {
      if (part.startsWith("`")) return escapeMarkup(part);
      if (
        (part.startsWith("**") && part.endsWith("**")) ||
        (part.startsWith("__") && part.endsWith("__"))
      )
        return `*${escapeMarkup(part.slice(2, -2))}*`;
      return escapeMarkup(part)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!])/g, "$1_$2_")
        .replace(/~~([^~]+)~~/g, "~$1~")
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        .replace(/^&gt; ?/gm, "> ");
    })
    .join("");
const fallback = (blocks: unknown[]): string =>
  blocks
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      const pieces = [
        block.text,
        ...(Array.isArray(block.elements) ? block.elements : []),
        ...(Array.isArray(block.fields) ? block.fields : []),
      ];
      return pieces.flatMap((piece) =>
        isRecord(piece) && typeof piece.text === "string" ? [piece.text] : [],
      );
    })
    .join("\n")
    .slice(0, 40000);
export const checkStdin = (input: Input): void => {
  if (["text", "blocks", "payload", "view"].filter((key) => input[key] === "-").length > 1)
    throw new UsageError("stdin cannot be used by multiple inputs");
};
const fields = [
  "channel",
  "text",
  "blocks",
  "attachments",
  "thread_ts",
  "reply_broadcast",
  "unfurl_links",
  "unfurl_media",
  "ts",
  "parse",
  "link_names",
  "mrkdwn",
  "metadata",
];
export const prepareMessage = async (
  input: Input,
  context: ExtensionContext,
  update = false,
): Promise<Input> => {
  checkStdin(input);
  let payload: Input = {};
  if (typeof input.payload === "string") {
    const parsed = await jsonSource(input.payload, context);
    if (!isRecord(parsed)) throw new UsageError("payload must be an object");
    payload = { ...parsed };
    for (const key of Object.keys(payload))
      if (!fields.includes(key)) throw new UsageError(`Unsupported payload field: ${key}`);
  }
  for (const key of fields) {
    const option = key.replaceAll("_", "-");
    const value = input[option];
    if (value === undefined) continue;
    if (payload[key] !== undefined) throw new UsageError(`payload conflicts with ${option}`);
    payload[key] = value;
  }
  if (payload.channel === undefined) throw new UsageError("A channel is required");
  payload.channel = await channel(context, String(payload.channel));
  if (input.text === "-") payload.text = await context.io.readStdin();
  if (
    payload.text !== undefined &&
    (typeof payload.text !== "string" || payload.text.length > 40000)
  )
    throw new UsageError("text must be a string of at most 40000 characters");
  if (input.blocks === "true") {
    if (typeof payload.text !== "string" || !payload.text)
      throw new UsageError("Markdown conversion requires text");
    const converted = markdown(payload.text);
    payload.blocks =
      converted
        .match(/[\s\S]{1,3000}/g)
        ?.map((part) => ({ type: "section", text: { type: "mrkdwn", text: part } })) ?? [];
  } else if (typeof input.blocks === "string")
    payload.blocks = await jsonSource(input.blocks, context);
  if (payload.blocks !== undefined) {
    const blocks = validateBlocks(payload.blocks);
    if (!update && !payload.text) payload.text = fallback(blocks);
  }
  if (typeof input.attachments === "string")
    payload.attachments = await jsonSource(input.attachments, context);
  if (
    payload.attachments !== undefined &&
    (!Array.isArray(payload.attachments) ||
      payload.attachments.length > 100 ||
      payload.attachments.some((item) => !isRecord(item)))
  )
    throw new UsageError("attachments must be an array with at most 100 entries");
  if (!update && !payload.text)
    throw new UsageError("Post requires text or blocks that provide accessible fallback text");
  if (update && !["text", "blocks", "attachments"].some((key) => payload[key] !== undefined))
    throw new UsageError(
      "Update requires text, blocks or attachments; empty values explicitly clear content",
    );
  if (payload.reply_broadcast === true && !payload.thread_ts)
    throw new UsageError("reply-broadcast requires thread-ts");
  return payload;
};
export const saveDryRun = async (input: Input, payload: Input): Promise<void> => {
  if (input["payload-out"] !== undefined && input["dry-run"] !== true)
    throw new UsageError("--payload-out requires --dry-run");
  if (typeof input["payload-out"] === "string")
    await writeFile(input["payload-out"], `${JSON.stringify(payload, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
};
export const postPolicy = (
  id: string,
  env: Record<string, string | undefined> = process.env,
): void => {
  const parse = (name: string): string[] | undefined => {
    const value = env[name];
    if (value === undefined) return undefined;
    const ids = value.split(",").map((item) => item.trim());
    if (ids.some((item) => !/^[CGD][A-Z0-9]{8,}$/.test(item)))
      throw new UsageError(`Invalid ${name}`);
    return ids;
  };
  const allowed = parse("SLACK_MCP_POST_CHANNEL_ALLOWLIST");
  const denied = parse("SLACK_MCP_POST_CHANNEL_DENYLIST");
  if ((allowed && !allowed.includes(id)) || denied?.includes(id))
    throw new UsageError("Channel is blocked by the Slack post policy");
};

export const requireAttachment = (env: Record<string, string | undefined> = process.env): void => {
  const enabled =
    /^(true|1|yes)$/i.test(env.SLACK_MCP_ATTACHMENT_TOOL ?? "") ||
    (env.SLACK_MCP_ENABLED_TOOLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .includes("attachment_get_data");
  if (!enabled)
    throw new UsageError(
      "Attachment access is disabled; set SLACK_MCP_ATTACHMENT_TOOL=true or enable attachment_get_data",
    );
};
