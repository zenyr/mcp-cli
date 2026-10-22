import { methodSchema } from "./web-schemas";
import type { CommandSpec, WebApiConfig } from "@mcp-cli/core";

const reads = [
  "auth.test",
  "conversations.list",
  "users.conversations",
  "conversations.info",
  "users.list",
  "users.info",
  "users.profile.get",
  "search.messages",
  "conversations.history",
  "conversations.replies",
  "pins.list",
  "reactions.get",
  "files.info",
  "usergroups.list",
  "usergroups.users.list",
];
const writes = [
  "conversations.join",
  "conversations.leave",
  "users.profile.set",
  "chat.postMessage",
  "chat.postEphemeral",
  "chat.delete",
  "chat.update",
  "conversations.mark",
  "pins.add",
  "pins.remove",
  "reactions.add",
  "reactions.remove",
  "usergroups.create",
  "usergroups.update",
  "usergroups.users.update",
  "views.publish",
];
export const webName = (method: string): string => `web.${method}`;
export const webTools: WebApiConfig["tools"] = [...reads, ...writes, "download"].map((method) => ({
  name: webName(method),
  method,
  description: `Slack Web API ${method}`,
  inputSchema: methodSchema(method),
  annotations: {
    readOnlyHint: reads.includes(method) || method === "download",
    idempotentHint: false,
  },
  requiredTokenPrefix: ["users.profile.set", "search.messages", "conversations.mark"].includes(
    method,
  )
    ? "xoxp-"
    : undefined,
  credentialError: "user_token_required",
  credentialKinds: method === "auth.test" ? { "xoxp-": "user", "xoxb-": "bot" } : undefined,
  errorCategories: {
    missing_scope: "permission",
    no_permission: "permission",
    restricted_action: "permission",
    invalid_auth: "authentication",
    not_authed: "authentication",
    token_revoked: "authentication",
    account_inactive: "authentication",
    unknown_method: "unsupported",
    method_not_supported: "unsupported",
  },
  maxDownloadBytes: 5 * 1024 * 1024,
  download: method === "download",
}));
export const apiCommands: CommandSpec[] = webTools.map((tool) => ({
  ...tool,
  path: ["call", tool.name],
  summary: `${tool.description} (${tool.annotations?.readOnlyHint ? "read-only" : "write"})`,
}));
