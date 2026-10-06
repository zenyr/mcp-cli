import type { CommandCustomization, GeneratedManifest } from "@mcp-cli/core";

export const commands: Record<string, CommandCustomization> = {
  "demo-echo": {
    path: ["message", "echo"],
    summary: "Echo a message",
    examples: ["demo message echo --text hello --count 2"],
  },
  "demo-fail": { path: ["message", "fail"], summary: "Return a tool error" },
  "demo-fields": { path: ["field", "set"], summary: "Accept nullable and union fields" },
};

export const manifest = {
  version: 2,
  service: "demo",
  tools: [
    {
      name: "demo-echo",
      description: "Echo a message",
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
      description: "Return an error",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
    },
    {
      name: "demo-fields",
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
} satisfies GeneratedManifest;
