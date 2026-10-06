import { definePlugin } from "@mcp-cli/core";
export default definePlugin({
  name: "linear",
  summary: "Linear issues, projects and cycles",
  auth: { type: "oauth" },
  // An explicit LINEAR_MCP_TOKEN (OAuth token or API key) takes precedence over credentials stored by `mcp-cli login linear`.
  connection: (env) => {
    const url = env.LINEAR_MCP_URL ?? "https://mcp.linear.app/mcp";
    const token = env.LINEAR_MCP_TOKEN;
    if (!token) return { type: "http", url };
    return { type: "http", url, authorize: async () => ({ Authorization: `Bearer ${token}` }) };
  },
});
