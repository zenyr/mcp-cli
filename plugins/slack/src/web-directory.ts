import { UsageError, type ExtensionContext } from "@mcp-cli/core";
import {
  call,
  channel,
  number,
  object,
  page,
  records,
  requireId,
  select,
  text,
  type Input,
} from "./web-common";
import { expiration } from "./web-datetime";

export const channels = async (
  path: string,
  input: Input,
  context: ExtensionContext,
): Promise<Input> => {
  if (["channels list", "channels search", "channels me"].includes(path)) {
    const types: Record<string, string> = {
      public: "public_channel",
      private: "private_channel",
      im: "im",
      mpim: "mpim",
    };
    const type = text(input, "type", "public");
    if (!types[type]) throw new UsageError("--type must be public, private, im or mpim");
    const targets = text(input, "query-targets", "name,topic,purpose").split(",");
    if (targets.some((key) => !["name", "topic", "purpose"].includes(key)))
      throw new UsageError("Invalid query targets");
    const sort = text(input, "sort", "name");
    if (!["name", "popularity"].includes(sort)) throw new UsageError("Invalid sort");
    const result = await page(
      context,
      path === "channels me" ? "users.conversations" : "conversations.list",
      "channels",
      { ...select(input, ["limit", "cursor"]), types: types[type] },
      true,
    );
    const query = text(input, "query").toLocaleLowerCase();
    const collected = records(result.items);
    const items = collected.filter(
      (item) =>
        !query ||
        targets.some((key) =>
          (key === "name" ? text(item, key) : text(object(item[key]), "value"))
            .toLocaleLowerCase()
            .includes(query),
        ),
    );
    items.sort((a, b) =>
      sort === "name"
        ? text(a, "name").localeCompare(text(b, "name"))
        : number(b, "num_members", 0) - number(a, "num_members", 0),
    );
    return {
      ...result,
      items,
      collected: collected.length,
      filter: { query, targets, mode: "local list filter" },
      sort,
      scope: "collected results only",
    };
  }
  const id = await channel(context, text(input, "channel"));
  return call(
    context,
    path === "channels info"
      ? "conversations.info"
      : path === "channels join"
        ? "conversations.join"
        : "conversations.leave",
    { channel: id },
  );
};
export const users = async (
  path: string,
  input: Input,
  context: ExtensionContext,
): Promise<Input> => {
  if (path === "users get") {
    const ids = [...new Set(Array.isArray(input.users) ? input.users.map(String) : [])];
    ids.forEach((id) => requireId(id, "user"));
    const items = [];
    for (const id of ids) {
      const response = await context.callTool("web.users.info", { user: id });
      items.push({ user: id, ok: !response.isError, result: response.structuredContent });
    }
    return { items, partial: items.some((item) => !item.ok), next_cursor: null };
  }
  if (path === "users list" || path === "users search") {
    const query = text(input, "query");
    if (path === "users search" && /^[UW][A-Z0-9]{8,}$/.test(query))
      return call(context, "users.info", { user: query });
    const result = await page(
      context,
      "users.list",
      "members",
      select(input, ["limit", "cursor"]),
      true,
    );
    const collected = records(result.items);
    return {
      ...result,
      collected: collected.length,
      query,
      items: collected.filter((item) =>
        [
          text(item, "name"),
          text(item, "real_name"),
          text(object(item.profile), "display_name"),
        ].some((value) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
      ),
    };
  }
  if (path === "users status get")
    return call(
      context,
      "users.profile.get",
      text(input, "user") ? { user: requireId(text(input, "user"), "user") } : {},
    );
  const profile =
    path === "users status clear"
      ? { status_text: "", status_emoji: "", status_expiration: 0 }
      : {
          status_text: text(input, "text"),
          status_emoji: `:${text(input, "emoji").replace(/^:|:$/g, "")}:`,
          status_expiration: expiration(text(input, "expiration"), text(input, "timezone")),
        };
  if (profile.status_text.length > 100 || profile.status_emoji.length > 100)
    throw new UsageError("Status text and emoji must not exceed 100 characters");
  return call(context, "users.profile.set", { profile });
};
const groups = async (context: ExtensionContext): Promise<Input[]> =>
  records((await call(context, "usergroups.list", { include_disabled: true })).usergroups);
const resolveGroup = async (context: ExtensionContext, value: string): Promise<Input> => {
  const matches = (await groups(context)).filter(
    (item) => item.id === value || item.handle === value.replace(/^@/, ""),
  );
  if (matches.length !== 1)
    throw new UsageError(
      `Group must match one ID or handle; candidates: ${JSON.stringify(matches)}`,
    );
  return matches[0] ?? {};
};
const members = async (context: ExtensionContext, id: string): Promise<string[]> => {
  const response = await call(context, "usergroups.users.list", { usergroup: id });
  if (!Array.isArray(response.users) || response.users.some((user) => typeof user !== "string"))
    throw new Error("Invalid usergroup members response");
  return response.users;
};
export const usergroups = async (
  path: string,
  input: Input,
  context: ExtensionContext,
): Promise<Input> => {
  if (path === "usergroups list") {
    const items = records(
      (await call(context, "usergroups.list", select(input, ["include-disabled"]))).usergroups,
    );
    const limit = number(input, "limit", 100);
    return {
      items: items.slice(0, limit),
      next_cursor: null,
      partial: items.length > limit,
      limit,
      total_available: items.length,
    };
  }
  if (path === "usergroups create") {
    if (!text(input, "name")) throw new UsageError("--name is required");
    return call(
      context,
      "usergroups.create",
      select(input, ["name", "handle", "description", "channels"]),
    );
  }
  if (path === "usergroups me list") {
    const user = text(await call(context, "auth.test"), "user_id");
    const items = [];
    for (const group of await groups(context))
      if ((await members(context, text(group, "id"))).includes(user)) items.push(group);
    const limit = number(input, "limit", 100);
    return {
      items: items.slice(0, limit),
      partial: items.length > limit,
      next_cursor: null,
      limit,
    };
  }
  const group = await resolveGroup(context, text(input, "group"));
  const id = requireId(text(group, "id"), "group");
  if (path === "usergroups get") return { group, users: await members(context, id) };
  if (path === "usergroups update") {
    const changes = select(input, ["name", "handle", "description", "channels"]);
    if (!Object.keys(changes).length) throw new UsageError("Specify at least one field to update");
    return call(context, "usergroups.update", { usergroup: id, ...changes });
  }
  let ids: string[];
  if (path === "usergroups users update")
    ids = Array.isArray(input.users) ? input.users.map(String) : [];
  else {
    const current = await members(context, id);
    const user = requireId(text(await call(context, "auth.test"), "user_id"), "user");
    ids = path.endsWith("join") ? [...current, user] : current.filter((item) => item !== user);
  }
  ids = [...new Set(ids)];
  ids.forEach((id) => requireId(id, "user"));
  if (!ids.length)
    throw new UsageError(
      "Slack does not allow an empty usergroup; refusing to remove its last member",
    );
  return {
    ...(await call(context, "usergroups.users.update", { usergroup: id, users: ids.join(",") })),
    membership_mode: "replace all",
    concurrent_update_risk: true,
  };
};
