import { definePlugin } from "@mcp-cli/core";
export default definePlugin({
  name: "slack",
  summary: "Slack messages, channels, canvases and users",
  // Slack's MCP server has no dynamic client registration, so a user token (xoxp) from a registered internal app is required.
  auth: { type: "apiKey", env: "SLACK_MCP_TOKEN" },
  connection: (env) => ({ type: "http", url: env.SLACK_MCP_URL ?? "https://mcp.slack.com/mcp" }),
});
