import { apiCommands, webTools } from "./web-methods";
import { webExtensions } from "./web";
import { postPolicy, requireAttachment } from "./web-payload";
import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";
import { sanitizeTools } from "./sanitize";
export default definePlugin({
  name: "slack",
  summary: "Slack channels, threads, messages and reactions",
  commands,
  apiCommands,
  extensions: webExtensions,
  beforeCall: async (command, input) => {
    if (["web.files.info", "web.download"].includes(command.name)) requireAttachment();
    if (command.name === "web.chat.postMessage" && typeof input.channel === "string")
      postPolicy(input.channel);
  },
  groups,
  quickstart,
  skill,
  sanitizeTools,
  // Slack's MCP server has no dynamic client registration, so keys come from a registered internal app.
  auth: {
    type: "apiKey",
    env: "SLACK_MCP_TOKEN",
    alternates: [
      { flag: "xoxp", base: true, env: "SLACK_MCP_TOKEN", summary: "Act as the user token (xoxp)" },
      { flag: "xoxb", env: "SLACK_MCP_BOT_TOKEN", summary: "Act as the bot token (xoxb)" },
    ],
  },
  connection: (env) => ({
    type: "http",
    url: env.SLACK_MCP_URL ?? "https://mcp.slack.com/mcp",
    webApi: {
      url: "https://slack.com/api/",
      tools: webTools,
      downloadHosts: ["files.slack.com", "slack-files.com"],
    },
  }),
});
