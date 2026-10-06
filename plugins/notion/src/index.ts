import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";
export default definePlugin({
  name: "notion",
  summary: "Notion pages, databases, comments and agents",
  commands,
  groups,
  quickstart,
  skill,
  auth: { type: "oauth" },
  // An explicit NOTION_MCP_TOKEN takes precedence over credentials stored by `mcp-cli login notion`.
  connection: (env) => {
    const url = env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";
    const token = env.NOTION_MCP_TOKEN;
    if (!token) return { type: "http", url };
    return { type: "http", url, authorize: async () => ({ Authorization: `Bearer ${token}` }) };
  },
});
