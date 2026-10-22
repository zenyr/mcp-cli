import { expect, test } from "bun:test";
import { applyCustomizations } from "@mcp-cli/core";
import slack from "../src";

test("Slack sends SLACK_MCP_TOKEN as a bearer API key", async () => {
  expect(slack.auth).toEqual({
    type: "apiKey",
    env: "SLACK_MCP_TOKEN",
    alternates: [
      { flag: "xoxp", base: true, env: "SLACK_MCP_TOKEN", summary: "Act as the user token (xoxp)" },
      { flag: "xoxb", env: "SLACK_MCP_BOT_TOKEN", summary: "Act as the bot token (xoxb)" },
    ],
  });
  expect(await slack.connection({})).toMatchObject({
    type: "http",
    url: "https://mcp.slack.com/mcp",
  });
  expect(await slack.connection({ SLACK_MCP_URL: "http://x/mcp" })).toMatchObject({
    type: "http",
    url: "http://x/mcp",
  });
});

test("a token with read scopes only still resolves and prunes write help", () => {
  const tool = (name: string) => ({ name, inputSchema: { type: "object" } });
  const manifest = applyCustomizations(slack, {
    version: 2,
    service: "slack",
    tools: [tool("slack_read_channel"), tool("slack_read_thread")],
  });
  expect(
    manifest.commands
      .filter((command) => !command.name.startsWith("web."))
      .map((command) => command.path.join(" ")),
  ).toEqual(["channel read", "thread read"]);
  expect(Object.keys(manifest.groups).sort()).toEqual(["channel", "thread"]);
  expect(manifest.quickstart.map((entry) => entry.command.split(" ")[0])).toEqual([
    "channel",
    "thread",
  ]);
});
