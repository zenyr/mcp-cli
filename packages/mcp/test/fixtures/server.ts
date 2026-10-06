import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isRecord } from "@mcp-cli/core";

// Usage: bun server.ts [tools|no-tools] [pid-file]
const mode = process.argv[2] ?? "tools";
const pidFile = process.argv[3];
if (pidFile) writeFileSync(pidFile, String(process.pid));

type Message = { id?: number | string; method?: string; params?: Record<string, unknown> };
const send = (message: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const numberArg = (args: unknown, key: string): number => {
  const value = isRecord(args) ? args[key] : undefined;
  return typeof value === "number" ? value : 0;
};

const tools = [
  { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  {
    name: "slow",
    inputSchema: {
      type: "object",
      properties: { ms: { type: "number" }, progressEveryMs: { type: "number" } },
    },
  },
];

// Resources and prompts span two pages so clients must follow nextCursor.
const resourcePages = [
  [{ uri: "fixture://text", name: "text", mimeType: "text/plain", description: "Plain text" }],
  [{ uri: "fixture://blob", name: "blob", mimeType: "application/octet-stream", size: 3 }],
];
const promptPages = [
  [{ name: "greet", description: "Greet someone", arguments: [{ name: "who", required: true }] }],
  [{ name: "plain" }],
];
const page = (pages: unknown[][], cursor: unknown) => {
  const index = cursor === "2" ? 1 : 0;
  return { items: pages[index] ?? [], ...(index === 0 && { nextCursor: "2" }) };
};
const readResource = (uri: unknown) => {
  if (uri === "fixture://text") return [{ uri, mimeType: "text/plain", text: "hello resource" }];
  if (uri === "fixture://blob") return [{ uri, blob: btoa("abc") }];
  return undefined;
};

const slow = async (id: Message["id"], params: Record<string, unknown>) => {
  const ms = numberArg(params.arguments, "ms");
  const every = numberArg(params.arguments, "progressEveryMs");
  const meta = params._meta;
  const token = isRecord(meta) ? meta.progressToken : undefined;
  const started = Date.now();
  while (Date.now() - started < ms) {
    await Bun.sleep(every > 0 ? every : ms);
    if (every > 0 && token !== undefined)
      send({
        method: "notifications/progress",
        params: { progressToken: token, progress: Date.now() - started },
      });
  }
  send({ id, result: { content: [{ type: "text", text: "done" }] } });
};

const handle = (message: Message) => {
  const { id, method, params = {} } = message;
  if (id === undefined) return;
  if (method === "initialize")
    return send({
      id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: mode === "no-tools" ? {} : { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
  if (method === "tools/list") return send({ id, result: { tools } });
  if (method === "resources/list") {
    const { items, ...rest } = page(resourcePages, params.cursor);
    return send({ id, result: { resources: items, ...rest } });
  }
  if (method === "resources/templates/list")
    return send({
      id,
      result: { resourceTemplates: [{ uriTemplate: "fixture://item/{id}", name: "item" }] },
    });
  if (method === "resources/read") {
    const contents = readResource(params.uri);
    if (contents) return send({ id, result: { contents } });
    return send({ id, error: { code: -32002, message: "Resource not found" } });
  }
  if (method === "prompts/list") {
    const { items, ...rest } = page(promptPages, params.cursor);
    return send({ id, result: { prompts: items, ...rest } });
  }
  if (method === "prompts/get") {
    const args = isRecord(params.arguments) ? params.arguments : {};
    const text = `Hello, ${String(args.who ?? "nobody")}`;
    return send({ id, result: { messages: [{ role: "user", content: { type: "text", text } }] } });
  }
  if (method === "tools/call" && params.name === "slow") return void slow(id, params);
  if (method === "tools/call") {
    const args = params.arguments;
    const text = isRecord(args) && typeof args.text === "string" ? args.text : "";
    return send({ id, result: { content: [{ type: "text", text }] } });
  }
  send({ id, error: { code: -32601, message: "Method not found" } });
};

for await (const line of createInterface({ input: process.stdin })) {
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed))
      handle({
        id: typeof parsed.id === "number" || typeof parsed.id === "string" ? parsed.id : undefined,
        method: typeof parsed.method === "string" ? parsed.method : undefined,
        params: isRecord(parsed.params) ? parsed.params : undefined,
      });
  } catch {
    continue;
  }
}
