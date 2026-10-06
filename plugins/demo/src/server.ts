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
const resources = [
  {
    uri: "demo://readme",
    name: "readme",
    title: "Demo README",
    description: "Short description of the demo server",
    mimeType: "text/markdown",
  },
];
const readme = "# Demo\n\nThe demo server echoes messages and returns errors on request.";
const prompts = [
  {
    name: "summarize",
    description: "Ask for a summary of a text",
    arguments: [
      { name: "text", description: "Text to summarize", required: true },
      { name: "style", description: "Summary style, for example bullet or short" },
    ],
  },
];
const summarize = (args: unknown) => {
  const text = isRecord(args) && typeof args.text === "string" ? args.text : "";
  const style = isRecord(args) && typeof args.style === "string" ? ` in ${args.style} style` : "";
  return [{ role: "user", content: { type: "text", text: `Summarize${style}:\n${text}` } }];
};
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
        capabilities: { tools: {}, resources: {}, prompts: {} },
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
    case "resources/list":
      result = { resources };
      break;
    case "resources/templates/list":
      result = { resourceTemplates: [] };
      break;
    case "resources/read": {
      const uri = isRecord(request.params) ? request.params.uri : undefined;
      if (uri !== "demo://readme") {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32002, message: "Resource not found" },
          }),
        );
        continue;
      }
      result = { contents: [{ uri, mimeType: "text/markdown", text: readme }] };
      break;
    }
    case "prompts/list":
      result = { prompts };
      break;
    case "prompts/get": {
      const params = isRecord(request.params) ? request.params : {};
      if (params.name !== "summarize") {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32602, message: "Unknown prompt" },
          }),
        );
        continue;
      }
      result = { description: "Summary request", messages: summarize(params.arguments) };
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
