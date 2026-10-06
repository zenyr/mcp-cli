import { definePlugin } from "@mcp-cli/core";
import { bearerAuthorize, envTokenSource } from "./auth";
export default definePlugin({
  name: "notion",
  summary: "Notion MCP tools with progressive command help",
  commands: {
    "notion-fetch": { path: ["fetch", "get"], examples: ["notion fetch get --id self"] },
    "notion-search": { path: ["search", "run"], examples: ["notion search run --query roadmap"] },
  },
  skill:
    "Use fetch before edits. Read notion://docs/enhanced-markdown-spec before content mutations.\nThis plugin supplies command mapping only; it does not migrate the existing Notion credential store or mutation guards.",
  connection: (env) => ({
    type: "http",
    url: env.NOTION_MCP_URL ?? "https://mcp.notion.com/mcp",
    authorize: bearerAuthorize(envTokenSource(env)),
  }),
});
