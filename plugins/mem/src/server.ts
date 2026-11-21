import { createInterface } from "node:readline";
import { isRecord } from "@mcp-cli/core";
import { callTool, tools, type MemContext } from "./tools";

type Request = { id: string | number; method: string; params?: unknown };

const isRequest = (value: unknown): value is Request =>
  isRecord(value) &&
  (typeof value.id === "string" || typeof value.id === "number") &&
  typeof value.method === "string";

/** Answers one JSON-RPC request, or returns an error object for unsupported methods. */
export const handle = async (
  request: Request,
  context: MemContext,
): Promise<{ result: unknown } | { error: { code: number; message: string } }> => {
  if (request.method === "initialize")
    return {
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "mem", version: "0.1.0" },
      },
    };
  if (request.method === "ping") return { result: {} };
  if (request.method === "tools/list") return { result: { tools } };
  if (request.method === "tools/call") {
    const params = isRecord(request.params) ? request.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    return { result: await callTool(name, params.arguments ?? {}, context) };
  }
  return { error: { code: -32601, message: "Method not found" } };
};

if (import.meta.main) {
  // Requests run one at a time so each call opens and closes the SQLite store alone.
  for await (const line of createInterface({ input: process.stdin })) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRequest(raw)) continue;
    const reply = await handle(raw, { cwd: process.cwd(), env: process.env });
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: raw.id, ...reply })}\n`);
  }
}
