import { fileURLToPath } from "node:url";
import { definePlugin } from "@mcp-cli/core";

export default definePlugin({
  name: "mem",
  summary: "Search and read local mem records without calling a model",
  connection: () => ({
    type: "stdio",
    command: "bun",
    args: [fileURLToPath(new URL("./server.ts", import.meta.url))],
  }),
  commands: {
    start: {
      path: ["memory", "start"],
      summary: "Print the startup memory packet",
      examples: ["mcp-cli mem memory start", "mcp-cli mem memory start --scope global"],
    },
    recall: {
      path: ["memory", "recall"],
      summary: "Search original records by keyword",
      examples: ['mcp-cli mem memory recall --query "deploy target" --limit 5'],
    },
    read: {
      path: ["record", "read"],
      summary: "Read one original record page",
      examples: ["mcp-cli mem record read --record <scopeId>/0"],
    },
  },
  groups: {
    memory: "Startup packet and keyword search",
    record: "Original record pages",
  },
  quickstart: [
    { command: "memory start", summary: "Load the startup memory packet" },
    { command: 'memory recall --query "decision"', summary: "Find records by keyword" },
  ],
  skill: `mem plugin tools only read records. Save and summarize with the standalone mem CLI.
Use memory recall, then record read --record with a returned recordId; pass returned cursors unchanged.`,
});
