import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";
export default definePlugin({
  name: "slack",
  summary: "Slack channels, threads, messages and reactions",
  commands,
  groups,
  quickstart,
  skill,
  // Slack's MCP server has no dynamic client registration, so keys come from a registered internal app.
  auth: {
    type: "apiKey",
    env: "SLACK_MCP_TOKEN",
    alternates: [
      { flag: "xoxb", env: "SLACK_MCP_BOT_TOKEN", summary: "Act as the bot token (xoxb)" },
    ],
  },
  connection: (env) => ({ type: "http", url: env.SLACK_MCP_URL ?? "https://mcp.slack.com/mcp" }),
});
