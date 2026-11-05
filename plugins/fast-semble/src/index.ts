import { definePlugin } from "@mcp-cli/core";
import { normalizeArgv } from "./argv";

export default definePlugin({
  name: "fast-semble",
  summary: "Search local code with Semble and reuse its MCP session",
  connection: () => ({
    type: "stdio",
    command: "uvx",
    args: ["--from", "semble[mcp]==0.7.2", "semble"],
  }),
  commands: {
    search: {
      path: ["search"],
      summary: "Find code by behavior or symbol name",
      examples: [
        'fast-semble search "authentication flow" .',
        'fast-semble search "deployment" . --content docs --top-k 3',
      ],
    },
    find_related: {
      path: ["find-related"],
      summary: "Find code related to a file and line",
      examples: ["fast-semble find-related src/auth.ts 42 ."],
    },
  },
  extensions: { commands: [], normalizeArgv },
  quickstart: [
    { command: 'search --query "authentication flow" --repo .', summary: "Search this repository" },
  ],
  sanitizeTools: (tools) =>
    tools.map((tool) =>
      tool.name === "search" || tool.name === "find_related"
        ? { ...tool, annotations: { ...tool.annotations, readOnlyHint: true } }
        : tool,
    ),
  skill: `Use fast-semble search "behavior or symbol" /absolute/repo to locate relevant code.
Use fast-semble find-related file_path line /absolute/repo with a search result.
Omitting the repository searches the current directory; use --input with a repo array for multiple repositories.
Use --top-k to limit results and --max-snippet-lines 0 for locations only.
Use --content docs, config, or all for non-code content.
Navigate to the returned paths and lines instead of repeating the same search.
Start the mcp-cli daemon or desktop app to reuse the local Semble process between calls.
Without the daemon, each invocation opens and closes its own Semble process.`,
});
