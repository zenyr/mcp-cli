import type { Manifest } from "@mcp-cli/core";

export const manifest = {
  version: 1,
  service: "demo",
  summary: "Local MCP example",
  commands: [
    {
      name: "demo-echo",
      path: ["message", "echo"],
      summary: "Echo a message",
      description: "Echo a message",
      examples: ["demo message echo --text hello --count 2"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string", description: "Message to echo" },
          count: { type: "integer", minimum: 1, maximum: 5 },
          uppercase: { type: "boolean" },
          labels: { type: "array", items: { type: "string" } },
          parent: {
            type: "object",
            additionalProperties: false,
            properties: { page_id: { type: "string" } },
          },
        },
      },
    },
    {
      name: "demo-fail",
      path: ["message", "fail"],
      summary: "Return a tool error",
      description: "Return an error",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "demo-fields",
      path: ["field", "set"],
      summary: "Accept nullable and union fields",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          size: { type: ["integer", "null"] },
          ratio: { anyOf: [{ type: "number" }, { type: "null" }] },
          enabled: { type: ["boolean", "null"] },
          label: { type: ["string", "null"] },
          meta: { oneOf: [{ type: "object" }, { type: "null" }] },
          amount: { type: "number" },
        },
      },
    },
  ],
} satisfies Manifest;
