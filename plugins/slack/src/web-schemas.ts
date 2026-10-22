import type { JsonSchema } from "@mcp-cli/core";
const definitions: Record<string, string> = {
  "auth.test": "",
  "conversations.list": "limit:n cursor types exclude_archived:b",
  "users.conversations": "user limit:n cursor types exclude_archived:b",
  "conversations.info": "channel! include_num_members:b",
  "conversations.join": "channel!",
  "conversations.leave": "channel!",
  "users.list": "limit:n cursor",
  "users.info": "user!",
  "users.profile.get": "user",
  "users.profile.set": "profile:o!",
  "search.messages": "query! count:n page:n",
  "conversations.history": "channel! limit:n cursor oldest latest inclusive:b",
  "conversations.replies": "channel! ts! limit:n cursor oldest latest inclusive:b",
  "chat.postMessage":
    "channel! text blocks:a attachments:a thread_ts reply_broadcast:b unfurl_links:b unfurl_media:b parse link_names:b mrkdwn:b metadata:o",
  "chat.postEphemeral": "channel! user! text! thread_ts",
  "chat.update": "channel! ts! text blocks:a attachments:a parse link_names:b metadata:o",
  "chat.delete": "channel! ts!",
  "conversations.mark": "channel! ts!",
  "pins.add": "channel! timestamp!",
  "pins.remove": "channel! timestamp!",
  "pins.list": "channel!",
  "reactions.add": "channel! timestamp! name!",
  "reactions.remove": "channel! timestamp! name!",
  "reactions.get": "channel! timestamp!",
  "files.info": "file!",
  "usergroups.list": "include_disabled:b",
  "usergroups.users.list": "usergroup!",
  "usergroups.create": "name! handle description channels",
  "usergroups.update": "usergroup! name handle description channels",
  "usergroups.users.update": "usergroup! users!",
  "views.publish": "user_id! view:o! hash",
  download: "url! save:b",
};
export const methodSchema = (method: string): JsonSchema => {
  const required: string[] = [];
  const properties: Record<string, JsonSchema> = {};
  for (const field of (definitions[method] ?? "").split(" ").filter(Boolean)) {
    const mandatory = field.endsWith("!");
    const [name = "", type = "s"] = field.replace(/!$/, "").split(":");
    properties[name] = {
      type:
        ({ n: "integer", b: "boolean", o: "object", a: "array" } as Record<string, string>)[type] ??
        "string",
    };
    if (mandatory) required.push(name);
  }
  return { type: "object", additionalProperties: false, properties, required };
};
