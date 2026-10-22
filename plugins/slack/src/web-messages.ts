import { UsageError, type ExtensionContext } from "@mcp-cli/core";
import {
  call,
  channel,
  messageUrl,
  number,
  object,
  page,
  records,
  requireId,
  select,
  target,
  text,
  timestamp,
  type Input,
} from "./web-common";
import { searchQuery } from "./web-datetime";
import { postPolicy, prepareMessage, saveDryRun } from "./web-payload";
const range = ["limit", "cursor", "oldest", "latest", "inclusive"];
const validateRange = (input: Input): void => {
  for (const key of ["oldest", "latest"]) if (input[key] !== undefined) timestamp(text(input, key));
};
const exact = async (
  context: ExtensionContext,
  ref: ReturnType<typeof messageUrl>,
): Promise<Input> => {
  const thread = ref.thread_ts && ref.thread_ts !== ref.ts;
  const response = thread
    ? await page(
        context,
        "conversations.replies",
        "messages",
        {
          channel: ref.channel,
          ts: ref.thread_ts,
          oldest: ref.ts,
          latest: ref.ts,
          inclusive: true,
          limit: 10000,
        },
        true,
      )
    : await page(context, "conversations.history", "messages", {
        channel: ref.channel,
        oldest: ref.ts,
        latest: ref.ts,
        inclusive: true,
        limit: 1,
      });
  const message = records(response.items).find((item) => item.ts === ref.ts);
  if (!message)
    throw new UsageError(`Target message was not returned; partial=${String(response.partial)}`);
  return message;
};
const unreads = async (input: Input, context: ExtensionContext): Promise<Input> => {
  if (input["include-muted"] !== undefined)
    throw new UsageError(
      "--include-muted is unsupported: Web API cannot reliably expose this user's muted-channel preferences",
    );
  const self = text(await call(context, "auth.test"), "user_id");
  const limit = number(input, "limit", 100);
  const listing = text(input, "channel")
    ? { items: [{ id: await channel(context, text(input, "channel")) }], partial: false }
    : await page(context, "users.conversations", "channels", { limit }, true);
  const items = [];
  let partial = listing.partial === true;
  for (const item of records(listing.items)) {
    const id = text(item, "id");
    const info = object(
      (await call(context, "conversations.info", { channel: id, include_num_members: false }))
        .channel,
    );
    if (typeof info.last_read !== "string")
      throw new UsageError(
        "Unread retrieval requires a last_read value visible to the selected token",
      );
    const result = await page(
      context,
      "conversations.history",
      "messages",
      { channel: id, oldest: info.last_read, inclusive: false, limit },
      true,
    );
    partial ||= result.partial === true;
    const messages = records(result.items).filter(
      (message) => input["mentions-only"] !== true || text(message, "text").includes(`<@${self}>`),
    );
    items.push({
      channel: id,
      last_read: info.last_read,
      items: messages,
      partial: result.partial,
      next_cursor: result.next_cursor,
    });
  }
  return {
    items,
    partial,
    next_cursor: "next_cursor" in listing ? listing.next_cursor : null,
    count_scope: "retrieved messages only",
    muted_filter: "unavailable; results may include muted channels",
  };
};
export const messages = async (
  path: string,
  input: Input,
  context: ExtensionContext,
): Promise<Input> => {
  if (path === "messages search") {
    if (number(input, "limit", 100) > 100)
      throw new UsageError("Search --limit must not exceed 100");
    const query = searchQuery(input);
    const response = await call(context, "search.messages", {
      query,
      count: number(input, "limit", 100),
      page: number(input, "page", 1),
    });
    const data = object(response.messages),
      paging = object(data.paging);
    return {
      ...response,
      items: records(data.matches),
      query,
      page: paging.page,
      next_page:
        number(paging, "page", 1) < number(paging, "pages", 1)
          ? number(paging, "page", 1) + 1
          : null,
      partial: number(paging, "page", 1) < number(paging, "pages", 1),
    };
  }
  if (path === "messages fetch" || path === "messages context") {
    const ref = messageUrl(text(input, "url"));
    const message = await exact(context, ref);
    if (path === "messages fetch") return { message, ...ref };
    const beforeCount = number(input, "before-count", 5),
      afterCount = number(input, "after-count", 5);
    const thread = ref.thread_ts && ref.thread_ts !== ref.ts;
    const base = { channel: ref.channel, ...(thread && { ts: ref.thread_ts }) };
    const method = thread ? "conversations.replies" : "conversations.history";
    const before = beforeCount
      ? await page(
          context,
          method,
          "messages",
          { ...base, latest: ref.ts, inclusive: false, limit: thread ? 10000 : beforeCount },
          Boolean(thread),
        )
      : { items: [], partial: false };
    const after = afterCount
      ? await page(
          context,
          method,
          "messages",
          { ...base, oldest: ref.ts, inclusive: false, limit: 10000 },
          true,
        )
      : { items: [], partial: false };
    const compare = (a: Input, b: Input) => text(a, "ts").localeCompare(text(b, "ts"));
    const preceding = records(before.items)
      .filter((item) => text(item, "ts") < ref.ts)
      .sort(compare);
    const following = records(after.items)
      .filter((item) => text(item, "ts") > ref.ts)
      .sort(compare);
    const sorted = [
      ...preceding.slice(-beforeCount || preceding.length),
      message,
      ...following.slice(0, afterCount),
    ];
    return {
      ...ref,
      items: sorted.map((item) => ({ ...item, target: item.ts === ref.ts })),
      truncated_before: before.partial || preceding.length > beforeCount,
      truncated_after: after.partial || following.length > afterCount,
      partial: before.partial || after.partial,
      ...(after.partial === true && {
        gap_after_target: true,
        scope: "context within 10000 retrieved messages",
      }),
    };
  }
  if (path === "messages unreads") return unreads(input, context);
  if (["messages post", "messages reply", "messages update"].includes(path)) {
    const normalized = { ...input };
    if (path === "messages reply") {
      const ref = messageUrl(text(input, "url"));
      normalized.channel = ref.channel;
      normalized["thread-ts"] = ref.thread_ts ?? ref.ts;
    } else if (path === "messages update" && text(input, "channel").startsWith("https:")) {
      const ref = messageUrl(text(input, "channel"));
      normalized.channel = ref.channel;
      normalized.ts = ref.ts;
    }
    const payload = await prepareMessage(normalized, context, path === "messages update");
    if (payload.ts !== undefined) timestamp(text(payload, "ts"));
    if (payload.thread_ts !== undefined) timestamp(text(payload, "thread_ts"));
    if (path === "messages update" && !payload.ts) throw new UsageError("Update requires ts");
    if (path !== "messages update") postPolicy(text(payload, "channel"));
    await saveDryRun(input, payload);
    if (input["dry-run"] === true)
      return {
        ok: true,
        dry_run: true,
        method: path === "messages update" ? "chat.update" : "chat.postMessage",
        payload,
      };
    return call(context, path === "messages update" ? "chat.update" : "chat.postMessage", payload);
  }
  if (path === "messages post-ephemeral") {
    const id = await channel(context, text(input, "channel"));
    const body = text(input, "text") === "-" ? await context.io.readStdin() : text(input, "text");
    return {
      ...(await call(context, "chat.postEphemeral", {
        channel: id,
        user: requireId(text(input, "user"), "user"),
        text: body,
        ...select(input, ["thread-ts"]),
      })),
      ephemeral: true,
      persistent_message: false,
    };
  }
  if (path === "messages history") {
    validateRange(input);
    return page(context, "conversations.history", "messages", {
      channel: await channel(context, text(input, "channel")),
      ...select(input, range),
    });
  }
  if (path === "messages pins") {
    const response = await call(context, "pins.list", {
      channel: await channel(context, text(input, "channel")),
    });
    const items = records(response.items);
    const limit = number(input, "limit", 100);
    return {
      ...response,
      items: items.slice(0, limit),
      partial: items.length > limit,
      next_cursor: null,
      limit,
    };
  }
  const ref = await target(context, input);
  if (path === "messages replies") {
    validateRange(input);
    return page(context, "conversations.replies", "messages", {
      channel: ref.channel,
      ts: ref.thread_ts ?? ref.ts,
      ...select(input, range),
    });
  }
  const method = {
    "messages delete": "chat.delete",
    "messages mark": "conversations.mark",
    "messages pin": "pins.add",
    "messages unpin": "pins.remove",
  }[path];
  if (!method) throw new UsageError("Unknown message operation");
  return call(context, method, {
    channel: ref.channel,
    ...(method.startsWith("pins.") ? { timestamp: ref.ts } : { ts: ref.ts }),
  });
};
