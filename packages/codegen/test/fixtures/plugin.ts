import { definePlugin } from "@mcp-cli/core";

export default definePlugin({
  name: "fixture",
  summary: "Codegen fixture service",
  commands: {
    "demo-echo": { path: ["message", "echo"], summary: "Echo a message" },
    "demo-fail": { path: ["message", "fail"], summary: "Return a tool error" },
  },
  connection: () => ({ type: "http", url: "http://localhost/mcp" }),
});
