import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Usage: bun server.ts [tools|no-tools] [pid-file]
const mode = process.argv[2] ?? "tools";
const pidFile = process.argv[3];
if (pidFile) writeFileSync(pidFile, String(process.pid));

type Message = { id?: number | string; method?: string; params?: Record<string, unknown> };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
        capabilities: mode === "no-tools" ? {} : { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
  if (method === "tools/list") return send({ id, result: { tools } });
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
