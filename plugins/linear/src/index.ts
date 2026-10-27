import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";
export default definePlugin({
  name: "linear",
  workspaces: { credentialEnv: ["LINEAR_MCP_TOKEN"] },
  summary: "Linear issues, projects and cycles",
  commands,
  groups,
  quickstart,
  skill,
  auth: { type: "oauth" },
  // An explicit LINEAR_MCP_TOKEN (OAuth token or API key) takes precedence over credentials stored by `mcp-cli login linear`.
  connection: (env) => {
    const url = env.LINEAR_MCP_URL ?? "https://mcp.linear.app/mcp";
    const token = env.LINEAR_MCP_TOKEN;
    if (!token) return { type: "http", url };
    return { type: "http", url, authorize: async () => ({ Authorization: `Bearer ${token}` }) };
  },
});
