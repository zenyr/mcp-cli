import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord, type ToolResult } from "@mcp-cli/core";
import { main } from "@mcp-cli/mem";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts } from "@mcp-cli/runtime/testing";
import plugin from "../src";
import { manifest } from "../src/generated";
import { handle } from "../src/server";
import { callTool, tools, type MemContext } from "../src/tools";

let root = "";
let context: MemContext;
let recordId = "";

const json = (result: ToolResult): Record<string, unknown> => {
  const block = result.content[0];
  const parsed: unknown = JSON.parse(typeof block?.text === "string" ? block.text : "");
  if (!isRecord(parsed)) throw new Error("mem returned a non-object response");
  return parsed;
};
const errorCode = (result: ToolResult): unknown => {
  const error = json(result).error;
  return isRecord(error) ? error.code : undefined;
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mem-plugin-"));
  const env = {
    HOME: root,
    XDG_DATA_HOME: join(root, "data"),
    XDG_CONFIG_HOME: join(root, "config"),
  };
  context = { cwd: root, env };
  let saved = "";
  // A failing compressor guarantees no model call, and a short record needs no summary.
  await main(["save", "Deploy target is blue", "--global"], {
    env,
    cwd: root,
    compress: async () => {
      throw new Error("offline");
    },
    io: { write: (text) => (saved += text), readFile: async () => "", readStdin: async () => "" },
  });
  const response: unknown = JSON.parse(saved);
  recordId = isRecord(response) && typeof response.recordId === "string" ? response.recordId : "";
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("recall finds the saved record and read returns its original text", async () => {
  expect(recordId).toMatch(/\/0$/);
  const found = await callTool("recall", { query: "deploy", scope: "global" }, context);
  expect(found.isError).toBeUndefined();
  expect(JSON.stringify(json(found))).toContain(recordId);
  const page = await callTool("read", { record: recordId, scope: "global" }, context);
  expect(json(page)).toMatchObject({ ok: true, text: "Deploy target is blue" });
});

test("start builds the packet and mem failures keep their error code", async () => {
  const packet = await callTool("start", { scope: "global" }, context);
  expect(packet.isError).toBeUndefined();
  expect(json(packet).generation).toEqual(expect.any(String));
  const missing = await callTool("read", { record: "global/99", scope: "global" }, context);
  expect(missing.isError).toBe(true);
  expect(json(missing).ok).toBe(false);
  expect(errorCode(missing)).toEqual(expect.any(String));
  expect(errorCode(missing)).not.toBe("INVALID_OPTION");
});

test("arguments cannot inject mem options", async () => {
  for (const [name, input] of [
    ["recall", { query: "--project", scope: "global" }],
    ["read", { record: "--global" }],
    ["recall", { query: "x", extra: true }],
    ["recall", { query: "x", constructor: "--global" }],
    ["start", { "": true }],
    ["recall", { query: "x", scope: "everything" }],
    ["recall", { query: "x", limit: "5" }],
    ["save", { text: "x" }],
  ] as const) {
    const result = await callTool(name, input, context);
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("INVALID_OPTION");
  }
});

test("maxBytes caps the mem JSON response", async () => {
  const result = await callTool(
    "recall",
    { query: "deploy", scope: "global", maxBytes: 512 },
    context,
  );
  const block = result.content[0];
  expect(Buffer.byteLength(String(block?.text))).toBeLessThanOrEqual(512);
});

test("the stdio server lists the generated tools and answers malformed requests", async () => {
  const server = Bun.spawn(["bun", join(import.meta.dir, "../src/server.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    env: { ...process.env, ...context.env },
    cwd: root,
  });
  for (const line of [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "nope" }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 4 }),
    "{not json",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "start", arguments: null },
    }),
  ])
    server.stdin.write(`${line}\n`);
  server.stdin.end();
  const replies = (await new Response(server.stdout).text())
    .trim()
    .split("\n")
    .map((line): unknown => JSON.parse(line))
    .filter(isRecord);
  expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3, 4, null, 5]);
  const listed = replies[1]?.result;
  const names = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : [];
  expect(names.map((tool: unknown) => (isRecord(tool) ? tool.name : undefined))).toEqual(
    manifest.tools.map((tool) => tool.name),
  );
  const called = replies[5]?.result;
  expect(isRecord(called) && called.isError).toBe(true);
  const codes = replies.slice(2, 5).map((reply) => (isRecord(reply.error) ? reply.error.code : 0));
  expect(codes).toEqual([-32601, -32600, -32700]);
  expect(tools.map((tool) => tool.name).sort()).toEqual(["read", "recall", "start"]);
  expect(tools.every((tool) => tool.annotations.readOnlyHint === false)).toBe(true);
});

test("command paths map to mem tools", async () => {
  const f = recordingPorts();
  const run = (args: string[]) => runService(plugin, manifest, args, f.ports);
  expect(await run(["memory", "recall", "--query", "deploy", "--limit", "5"])).toBe(0);
  expect(await run(["record", "read", "--record", "global/0"])).toBe(0);
  expect(await run(["memory", "start", "--scope", "global"])).toBe(0);
  expect(f.calls).toEqual([
    { name: "recall", input: { query: "deploy", limit: 5 } },
    { name: "read", input: { record: "global/0" } },
    { name: "start", input: { scope: "global" } },
  ]);
});

test("the server treats null arguments as invalid input", async () => {
  const reply = await handle(
    { id: 1, method: "tools/call", params: { name: "start", arguments: null } },
    context,
  );
  const result = "result" in reply && isRecord(reply.result) ? reply.result : {};
  expect(result.isError).toBe(true);
});
