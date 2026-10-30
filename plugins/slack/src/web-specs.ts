import type { JsonSchema } from "@mcp-cli/core";
export type WebSpec = {
  path: string;
  method: string;
  args: string[];
  options: string;
  write?: boolean;
  details?: string;
};
const spec = (
  path: string,
  method: string,
  args: string,
  options = "",
  write = false,
  details = "",
): WebSpec => ({ path, method, args: args.split(" ").filter(Boolean), options, write, details });
const list = "limit:n cursor:s";
const range = `${list} oldest:s latest:s inclusive:b`;
const payload = "blocks:s attachments:s payload:s dry-run:b payload-out:s";
export const specs: WebSpec[] = [
  spec("channels list", "conversations.list", "", `${list} type:s query:s query-targets:s sort:s`),
  spec("channels me", "users.conversations", "", list),
  spec("channels info", "conversations.info", "channel"),
  spec(
    "channels search",
    "conversations.list",
    "query",
    `${list} type:s query-targets:s sort:s`,
    false,
    "Local name/topic/purpose search across pages up to --limit (default 100). Reports partial results.",
  ),
  spec("channels join", "conversations.join", "channel", "", true),
  spec("channels leave", "conversations.leave", "channel", "", true),
  spec("users list", "users.list", "", `${list} query:s`),
  spec("users get", "users.info", "users..."),
  spec("users search", "users.list", "query", list),
  spec("users status get", "users.profile.get", "user?"),
  spec("users status set", "users.profile.set", "emoji text", "expiration:s timezone:s", true),
  spec("users status clear", "users.profile.set", "", "", true),
  spec(
    "messages search",
    "search.messages",
    "query",
    "limit:n page:n channel:s im:s with:s user:s threads:b after:s before:s on:s during:s timezone:s",
  ),
  spec("messages fetch", "conversations.history", "url"),
  spec("messages history", "conversations.history", "channel", range),
  spec("messages context", "conversations.history", "url", "before-count:n after-count:n"),
  spec(
    "messages post",
    "chat.postMessage",
    "channel? text?",
    `${payload} thread-ts:s reply-broadcast:b unfurl-links:b unfurl-media:b`,
    true,
  ),
  spec("messages post-ephemeral", "chat.postEphemeral", "channel user text", "thread-ts:s", true),
  spec("messages delete", "chat.delete", "channel ts?", "", true),
  spec("messages update", "chat.update", "channel? ts? text?", payload, true),
  spec("messages reply", "chat.postMessage", "url text?", payload, true),
  spec("messages replies", "conversations.replies", "channel ts?", range),
  spec(
    "messages unreads",
    "conversations.history",
    "",
    "channel:s limit:n mentions-only:b include-muted:b",
  ),
  spec("messages mark", "conversations.mark", "channel ts", "", true),
  spec("messages pin", "pins.add", "channel ts?", "", true),
  spec("messages unpin", "pins.remove", "channel ts?", "", true),
  spec("messages pins", "pins.list", "channel", "limit:n"),
  spec("reactions add", "reactions.add", "channel ts emoji?", "", true),
  spec("reactions remove", "reactions.remove", "channel ts emoji?", "", true),
  spec("reactions list", "reactions.get", "channel ts?"),
  spec(
    "attachment get",
    "files.info",
    "file",
    "content:b save:b",
    false,
    "Disabled by default. Web API metadata; content/save have a 5 MiB limit and untrusted contents. MCP file read remains separate with server-defined limits.",
  ),
  spec("usergroups list", "usergroups.list", "", "include-disabled:b limit:n"),
  spec("usergroups get", "usergroups.users.list", "group"),
  spec(
    "usergroups create",
    "usergroups.create",
    "",
    "name:s handle:s description:s channels:s",
    true,
  ),
  spec(
    "usergroups update",
    "usergroups.update",
    "group",
    "name:s handle:s description:s channels:s",
    true,
  ),
  spec(
    "usergroups users update",
    "usergroups.users.update",
    "group users...",
    "",
    true,
    "Replaces the entire member list.",
  ),
  spec("usergroups me list", "usergroups.list", "", "limit:n"),
  spec(
    "usergroups me join",
    "usergroups.users.update",
    "group",
    "",
    true,
    "Read-modify-write may overwrite concurrent membership changes.",
  ),
  spec(
    "usergroups me leave",
    "usergroups.users.update",
    "group",
    "",
    true,
    "Read-modify-write may overwrite concurrent membership changes. Removing the last member is refused.",
  ),
  spec("views publish", "views.publish", "user", "view:s hash:s", true),
  spec("views clear", "views.publish", "user", "", true),
  spec("auth check", "auth.test", ""),
  spec("auth whoami", "auth.test", ""),
  spec(
    "batch",
    "batch",
    "commands...",
    "stop-on-error:b fail-on-error:b",
    true,
    "Up to 50 commands, sequential; no shell; successful items are never retried as a batch.",
  ),
];
export const schemaFor = (entry: WebSpec): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: {
    args: {
      type: "array",
      items: { type: "string" },
      description: `Legacy positional arguments: ${entry.args.join(" ")}; prefer named fields.`,
    },
    ...Object.fromEntries(
      entry.args.map((field) => [
        field.replace(/\?|\.\.\./g, ""),
        field.endsWith("...")
          ? { type: "array", items: { type: "string" }, minItems: 1 }
          : { type: "string" },
      ]),
    ),
    ...Object.fromEntries(
      entry.options
        .split(" ")
        .filter(Boolean)
        .map((field) => {
          const [key = "", type] = field.split(":");
          return [
            key,
            type === "n"
              ? {
                  type: "integer",
                  minimum: key.endsWith("count") ? 0 : 1,
                  maximum: key.endsWith("count") ? 100 : 10000,
                }
              : { type: type === "b" ? "boolean" : "string" },
          ];
        }),
    ),
  },
});
