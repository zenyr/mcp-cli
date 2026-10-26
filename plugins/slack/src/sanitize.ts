import type { ToolDefinition } from "@mcp-cli/core";

const currentUser = /the current logged in user's user_id is [UW][A-Z0-9]+/gi;

export const sanitizeTools = (tools: ToolDefinition[]): ToolDefinition[] =>
  tools.map((tool) =>
    tool.description === undefined
      ? tool
      : {
          ...tool,
          description: tool.description.replace(
            currentUser,
            "resolve the currently authenticated user's user_id at runtime",
          ),
        },
  );
