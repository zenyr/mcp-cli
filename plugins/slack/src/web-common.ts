import { isRecord, UsageError, type ExtensionContext, type ToolResult } from "@mcp-cli/core";
import { webName } from "./web-methods";
export type Input = Record<string, unknown>;
export const output = (data: Input, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
  ...(isError && { isError }),
});
export class SlackFailure extends Error {
  result: ToolResult = { content: [] };
}
export const call = async (
  context: ExtensionContext,
  method: string,
  input: Input = {},
): Promise<Input> => {
  const response = await context.callTool(webName(method), input);
  if (response.isError)
    throw Object.assign(new SlackFailure("Slack request failed"), { result: response });
  if (!isRecord(response.structuredContent)) throw new Error("Invalid Web API response");
  return response.structuredContent;
};
export const text = (input: Input, key: string, fallback = ""): string => {
  const value = input[key];
  return typeof value === "string" ? value : fallback;
};
export const number = (input: Input, key: string, fallback: number): number => {
  const value = input[key];
  return typeof value === "number" ? value : fallback;
};
export const records = (value: unknown): Input[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
export const object = (value: unknown): Input => (isRecord(value) ? value : {});
export const select = (input: Input, keys: string[]): Input =>
  Object.fromEntries(
    keys
      .filter((key) => input[key] !== undefined)
      .map((key) => [key.replaceAll("-", "_"), input[key]]),
  );
export const requireId = (value: string, kind: "channel" | "user" | "file" | "group"): string => {
  const pattern = {
    channel: /^[CGD][A-Z0-9]{8,}$/,
    user: /^[UW][A-Z0-9]{8,}$/,
    file: /^F[A-Z0-9]{8,}$/,
    group: /^S[A-Z0-9]{8,}$/,
  }[kind];
  if (!pattern.test(value)) throw new UsageError(`Invalid ${kind} ID: ${value}`);
  return value;
};
export const timestamp = (value: string): string => {
  if (!/^\d{10,}\.\d{6}$/.test(value))
    throw new UsageError("ts must be a Slack timestamp string with six fractional digits");
  return value;
};
export const messageUrl = (value: string): { channel: string; ts: string; thread_ts?: string } => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("Invalid Slack message URL");
  }
  const match = /^\/archives\/([CGD][A-Z0-9]{8,})\/p(\d{16,})\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw new UsageError("Invalid Slack message URL");
  const digits = match[2] ?? "";
  const ts = timestamp(`${digits.slice(0, -6)}.${digits.slice(-6)}`);
  const thread = url.searchParams.get("thread_ts");
  return {
    channel: requireId(match[1] ?? "", "channel"),
    ts,
    ...(thread && { thread_ts: timestamp(thread) }),
  };
};
export const page = async (
  context: ExtensionContext,
  method: string,
  key: string,
  input: Input,
  all = false,
): Promise<Input> => {
  const limit = number(input, "limit", 100);
  const items: Input[] = [];
  let cursor = text(input, "cursor");
  const seen = new Set<string>();
  let hasMore = false;
  do {
    const response = await call(context, method, {
      ...input,
      limit: Math.min(limit - items.length, 200),
      ...(cursor && { cursor }),
    });
    items.push(...records(response[key]));
    cursor = text(object(response.response_metadata), "next_cursor");
    hasMore = response.has_more === true || Boolean(cursor);
    if (cursor && seen.has(cursor)) throw new Error("Slack returned a repeated cursor");
    seen.add(cursor);
    if (!all || !cursor) break;
  } while (items.length < limit);
  return {
    items,
    next_cursor: cursor || null,
    partial: hasMore,
    limit,
    scope: "collected results",
  };
};
export const channel = async (context: ExtensionContext, value: string): Promise<string> => {
  if (/^[CGD][A-Z0-9]{8,}$/.test(value)) return value;
  const name = value.replace(/^#/, "");
  if (!name || /[\s/]/.test(name)) throw new UsageError("Invalid channel name");
  const result = await page(
    context,
    "conversations.list",
    "channels",
    { limit: 10000, types: "public_channel,private_channel,im,mpim" },
    true,
  );
  const matches = records(result.items).filter((item) => item.name === name);
  if (matches.length > 1)
    throw new UsageError(
      `Ambiguous channel: ${JSON.stringify(matches.map((item) => ({ id: item.id, name: item.name })))}`,
    );
  if (result.partial)
    throw new UsageError(
      `Channel lookup is incomplete (10000 item limit); use a channel ID. Candidates: ${JSON.stringify(matches)}`,
    );
  const match = matches[0];
  if (!match)
    throw new UsageError(
      "No visible channel matches this name; private-channel visibility depends on token scopes and membership",
    );
  return requireId(text(match, "id"), "channel");
};
export const target = async (
  context: ExtensionContext,
  input: Input,
): Promise<{ channel: string; ts: string; thread_ts?: string }> =>
  text(input, "channel").startsWith("https:")
    ? messageUrl(text(input, "channel"))
    : { channel: await channel(context, text(input, "channel")), ts: timestamp(text(input, "ts")) };
