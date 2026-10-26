import { expect, test } from "bun:test";
import type { ToolDefinition } from "@mcp-cli/core";
import slack from "../src";
import { sanitizeTools } from "../src/sanitize";

test("Slack removes captured account IDs without changing tool schemas or usage rules", () => {
  const source: ToolDefinition[] = [
    {
      name: "slack_send_message",
      description:
        "To DM a user, use their user_id as channel_id. If the user wants to send a message to themselves, the current logged in user's user_id is U00TESTUSER. Return the message link to the user.",
      inputSchema: { type: "object", properties: { channel_id: { type: "string" } } },
    },
    { name: "no_description", inputSchema: { type: "object" } },
  ];
  const sanitized = sanitizeTools(source);
  expect(sanitized[0]?.description).not.toContain("U00TESTUSER");
  expect(sanitized[0]?.description).toContain(
    "resolve the currently authenticated user's user_id at runtime",
  );
  expect(sanitized[0]?.description).toContain("To DM a user, use their user_id as channel_id.");
  expect(sanitized[0]?.description).toContain("Return the message link to the user.");
  expect(sanitized[0]?.inputSchema).toEqual(source[0]?.inputSchema);
  expect(sanitized[1]).toEqual(source[1]);
  expect(sanitizeTools(sanitized)).toEqual(sanitized);
  expect(slack.sanitizeTools).toBe(sanitizeTools);
  expect(source[0]?.description).toContain("U00TESTUSER");
});
