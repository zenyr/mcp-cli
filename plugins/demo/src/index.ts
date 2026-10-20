import { fileURLToPath } from "node:url";
import { definePlugin } from "@mcp-cli/core";
declare const MCP_CLI_BUNDLED: boolean;

export default definePlugin({
  name: "demo",
  summary: "Local MCP example",
  commands: {
    "demo-echo": {
      path: ["message", "echo"],
      summary: "Echo a message",
      examples: ["demo message echo --text hello --count 2"],
    },
    "demo-fail": { path: ["message", "fail"], summary: "Return a tool error" },
  },
  connection: () =>
    typeof MCP_CLI_BUNDLED !== "undefined" && MCP_CLI_BUNDLED
      ? { type: "stdio", command: process.execPath, args: ["--demo-server"] }
      : {
          type: "stdio",
          command: "bun",
          args: [fileURLToPath(new URL("./server.ts", import.meta.url))],
        },
});
