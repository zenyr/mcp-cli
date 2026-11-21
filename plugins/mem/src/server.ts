import { createInterface } from "node:readline";
import { isRecord } from "@mcp-cli/core";
import { callTool, tools, type MemContext } from "./tools";

type Request = { id: string | number; method: string; params?: unknown };
type Reply = { result: unknown } | { error: { code: number; message: string } };

/** Answers one JSON-RPC request, or returns an error object for unsupported methods. */
export const handle = async (request: Request, context: MemContext): Promise<Reply> => {
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
    // Only a missing arguments field means no arguments; null and other values fail validation.
    const input = "arguments" in params ? params.arguments : {};
    return { result: await callTool(name, input, context) };
  }
  return { error: { code: -32601, message: "Method not found" } };
};

/** Answers one input line, or returns undefined for notifications. */
export const answer = async (
  line: string,
  context: MemContext,
): Promise<(Reply & { id: string | number | null }) | undefined> => {
  if (!line.trim()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { id: null, error: { code: -32700, message: "Parse error" } };
  }
  if (!isRecord(raw)) return undefined;
  const { id, method, params } = raw;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  if (typeof method !== "string")
    return { id, error: { code: -32600, message: "Invalid request" } };
  return { id, ...(await handle({ id, method, params }, context)) };
};

if (import.meta.main) {
  // Requests run one at a time so each call opens and closes the SQLite store alone.
  for await (const line of createInterface({ input: process.stdin })) {
    const reply = await answer(line, { cwd: process.cwd(), env: process.env });
    if (reply) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...reply })}\n`);
  }
}
