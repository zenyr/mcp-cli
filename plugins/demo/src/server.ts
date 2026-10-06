import { createInterface } from "node:readline";
import { isRecord } from "@mcp-cli/core";
import { echoInput, isRequest } from "./protocol";
const tools = [
  {
    name: "demo-echo",
    description: "Echo a message",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message to echo" },
        count: { type: "integer", minimum: 1, maximum: 5 },
        uppercase: { type: "boolean" },
        labels: { type: "array", items: { type: "string" } },
        parent: {
          type: "object",
          properties: { page_id: { type: "string" } },
          additionalProperties: false,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "demo-fail",
    description: "Return an error",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    continue;
  }
  if (!isRequest(raw)) continue;
  const request = raw;
  let result: unknown;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "demo", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = { tools };
      break;
    case "tools/call": {
      const params = request.params;
      const input = isRecord(params) ? echoInput(params.arguments) : undefined;
      if (isRecord(params) && params.name === "demo-fail") {
        result = { isError: true, content: [{ type: "text", text: "Demo failure" }] };
      } else if (isRecord(params) && params.name === "demo-echo" && input) {
        result = {
          content: [
            {
              type: "text",
              text: Array(input.count)
                .fill(input.uppercase ? input.text.toUpperCase() : input.text)
                .join("\n"),
            },
          ],
        };
      } else {
        result = { isError: true, content: [{ type: "text", text: "Invalid tool or input" }] };
      }
      break;
    }
    default:
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      continue;
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
}
