import { definePlugin } from "@mcp-cli/core";
export default definePlugin({
  name: "notion",
  summary: "Notion MCP tools with progressive command help",
  commands: {
    "notion-fetch": { path: ["fetch", "get"], examples: ["notion fetch get --id self"] },
    "notion-search": { path: ["search", "run"], examples: ["notion search run --query roadmap"] },
  },
  skill:
    "Use fetch before edits. Read notion://docs/enhanced-markdown-spec before content mutations.\nThis plugin supplies command mapping only; it does not migrate the existing Notion mutation guards.",
  auth: { type: "oauth" },
  // An explicit NOTION_MCP_TOKEN takes precedence over credentials stored by `mcp-cli login notion`.
  connection: (env) => {
    const url = env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp";
    const token = env.NOTION_MCP_TOKEN;
    if (!token) return { type: "http", url };
    return { type: "http", url, authorize: async () => ({ Authorization: `Bearer ${token}` }) };
  },
});
