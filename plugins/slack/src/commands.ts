import type { CommandCustomization, QuickstartEntry } from "@mcp-cli/core";

// Slack lists only the tools its token scopes allow, so every mapping is optional.
const optional = (
  mappings: Record<string, CommandCustomization>,
): Record<string, CommandCustomization> =>
  Object.fromEntries(
    Object.entries(mappings).map(([name, mapping]) => [name, { ...mapping, optional: true }]),
  );

export const commands = optional({
  slack_read_channel: {
    path: ["channel", "read"],
    summary: "Read channel or DM history, newest first",
    examples: ["slack channel read --channel-id C0123456789 --limit 20"],
  },
  slack_read_thread: {
    path: ["thread", "read"],
    summary: "Read a thread's parent message and replies",
    examples: ["slack thread read --channel-id C0123456789 --message-ts 1234567890.123456"],
  },
  slack_send_message: {
    path: ["message", "send"],
    summary: "Send a message to a channel, a user or a thread",
    examples: [
      'slack message send --channel-id C0123456789 --message "Deploy finished"',
      'slack message send --channel-id C0123456789 --thread-ts 1234567890.123456 --message "Done"',
    ],
  },
  slack_schedule_message: {
    path: ["message", "schedule"],
    summary: "Schedule a message at a Unix timestamp (2 minutes to 120 days ahead)",
  },
  slack_send_message_draft: {
    path: ["message", "draft"],
    summary: "Save a draft in Drafts & Sent without sending it",
  },
  slack_add_reaction: {
    path: ["reaction", "add"],
    summary: "Add an emoji reaction to a message",
    examples: [
      "slack reaction add --channel-id C0123456789 --message-ts 1234567890.123456 --emoji eyes",
    ],
  },
  slack_get_reactions: { path: ["reaction", "list"], summary: "List reactions on a message" },
  slack_read_file: { path: ["file", "read"], summary: "Read a file's content by file ID" },
});

export const groups: Record<string, string> = {
  channel: "Channel and DM history",
  thread: "Thread replies",
  message: "Send, schedule and draft messages",
  reaction: "Emoji reactions",
  file: "File contents",
};

export const quickstart: QuickstartEntry[] = [
  { command: "channel read --channel-id <id> --limit 20", summary: "Read recent messages" },
  { command: "thread read --channel-id <id> --message-ts <ts>", summary: "Read a thread" },
  { command: 'message send --channel-id <id> --message "..."', summary: "Post as yourself" },
];

export const skill = [
  "Discover progressively: slack --help, then <noun> --help, then <noun> <verb> --help.",
  "Commands act as the user token (xoxp) by default; add --xoxb to act as the bot token instead.",
  "Store keys once with mcp-cli login slack [--xoxb]; SLACK_MCP_TOKEN or SLACK_MCP_BOT_TOKEN override them.",
  "",
  "IDs:",
  "  Channels use IDs such as C0123456789; a user ID (U...) as --channel-id targets that DM.",
  "  Messages and threads are addressed by --message-ts, the Slack ts string such as 1234567890.123456.",
  "",
  "Rules:",
  "  Confirm the channel and text with the user before message send or message schedule.",
  "  Prefer message draft when the user wants to review text in Slack first.",
  "",
  "Available tools follow the token's User Token Scopes; add scopes, reinstall the app and run mcp-cli generate slack.",
].join("\n");
