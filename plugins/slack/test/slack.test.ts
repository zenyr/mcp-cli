import { expect, test } from "bun:test";
import slack from "../src";

test("Slack sends SLACK_MCP_TOKEN as a bearer API key", async () => {
  expect(slack.auth).toEqual({ type: "apiKey", env: "SLACK_MCP_TOKEN" });
  expect(await slack.connection({})).toEqual({ type: "http", url: "https://mcp.slack.com/mcp" });
  expect(await slack.connection({ SLACK_MCP_URL: "http://x/mcp" })).toEqual({
    type: "http",
    url: "http://x/mcp",
  });
});
