import { definePlugin } from "@mcp-cli/core";
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
  connection: () => ({
    type: "stdio",
    command: "bun",
    args: [new URL("./server.ts", import.meta.url).pathname],
  }),
});
