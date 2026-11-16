import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "@mcp-cli/core";
import { connect, MissingToolsCapabilityError } from "../src";

const fixture = join(import.meta.dir, "fixtures", "server.ts");
const stdio = (...args: string[]): Connection => ({
  type: "stdio",
  command: "bun",
  args: [fixture, ...args],
});
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitForExit = async (pid: number) => {
  for (let attempt = 0; attempt < 300 && isRunning(pid); attempt += 1) await Bun.sleep(10);
  return !isRunning(pid);
};
const withTempDir = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-cli-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("real stdio MCP discovery and execution", async () => {
  const session = await connect(stdio());
  try {
    expect((await session.listTools()).map((tool) => tool.name)).toEqual(["echo", "slow"]);
    expect(await session.callTool("echo", { text: "hello" })).toMatchObject({
      content: [{ type: "text", text: "hello" }],
    });
  } finally {
    await session.close();
  }
});

test("listTools fails explicitly when the tools capability is missing", async () => {
  const session = await connect(stdio("no-tools"));
  try {
    await expect(session.listTools()).rejects.toBeInstanceOf(MissingToolsCapabilityError);
  } finally {
    await session.close();
  }
});

test("call timeout is configurable and resets on progress", async () => {
  const session = await connect(stdio(), { callTimeoutMs: 300 });
  try {
    await expect(session.callTool("slow", { ms: 600 })).rejects.toThrow();
    expect(await session.callTool("slow", { ms: 600, progressEveryMs: 50 })).toMatchObject({
      content: [{ type: "text", text: "done" }],
    });
  } finally {
    await session.close();
  }
}, 5000);

test("max call timeout bounds calls that keep reporting progress", async () => {
  const session = await connect(stdio(), { callTimeoutMs: 300, maxCallTimeoutMs: 400 });
  try {
    await expect(session.callTool("slow", { ms: 1000, progressEveryMs: 50 })).rejects.toThrow();
  } finally {
    await session.close();
  }
}, 5000);

test("close stops the stdio server process", () =>
  withTempDir(async (directory) => {
    const pidFile = join(directory, "pid");
    const session = await connect(stdio("tools", pidFile));
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(isRunning(pid)).toBe(true);
    await session.close();
    expect(await waitForExit(pid)).toBe(true);
  }));

test(
  "connection timeout closes a silent stdio process",
  () =>
    withTempDir(async (directory) => {
      const pidFile = join(directory, "pid");
      const script = `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
      await expect(
        connect({ type: "stdio", command: "bun", args: ["-e", script] }, { timeoutMs: 200 }),
      ).rejects.toThrow();
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      expect(await waitForExit(pid)).toBe(true);
    }),
  5000,
);

test("invalid timeouts fail before starting transport", async () => {
  for (const value of [0, -1, Number.NaN, Infinity]) {
    await expect(connect(stdio(), { timeoutMs: value })).rejects.toThrow("Timeout");
    await expect(connect(stdio(), { callTimeoutMs: value })).rejects.toThrow("timeout");
    await expect(connect(stdio(), { maxCallTimeoutMs: value })).rejects.toThrow("timeout");
    await expect(connect(stdio(), { terminateTimeoutMs: value })).rejects.toThrow("timeout");
  }
});

const httpServer = (onDelete: () => Promise<Response>) => {
  const deletes: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (request.method === "DELETE") {
        deletes.push(request.headers.get("mcp-session-id") ?? "");
        return onDelete();
      }
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const body: unknown = await request.json();
      const message = typeof body === "object" && body !== null ? body : {};
      const id = "id" in message ? message.id : undefined;
      const method = "method" in message ? message.method : undefined;
      if (id === undefined) return new Response(null, { status: 202 });
      const result =
        method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "http-fixture", version: "1.0.0" },
            }
          : undefined;
      const payload = result
        ? { jsonrpc: "2.0", id, result }
        : { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
      return Response.json(payload, { headers: { "mcp-session-id": "session-1" } });
    },
  });
  return { url: `http://localhost:${server.port}/mcp`, deletes, stop: () => server.stop(true) };
};

test("HTTP close terminates the server session", async () => {
  const server = httpServer(async () => new Response(null, { status: 200 }));
  try {
    const session = await connect({ type: "http", url: server.url });
    await session.close();
    expect(server.deletes).toEqual(["session-1"]);
  } finally {
    await server.stop();
  }
});

test("HTTP close ignores terminate failures and stays bounded", async () => {
  const failing = httpServer(async () => new Response(null, { status: 500 }));
  const hanging = httpServer(() => new Promise<Response>(() => undefined));
  try {
    await (await connect({ type: "http", url: failing.url })).close();
    const session = await connect({ type: "http", url: hanging.url }, { terminateTimeoutMs: 100 });
    const started = Date.now();
    await session.close();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(hanging.deletes).toEqual(["session-1"]);
  } finally {
    await failing.stop();
    await hanging.stop();
  }
}, 5000);

test("session discovery atomically aggregates all pages", async () => {
  const session = await connect(stdio("paged"), { sessionTools: true });
  try {
    const results = await Promise.all([session.listTools(), session.listTools()]);
    expect(results[0]?.map(({ name }) => name)).toEqual(["echo", "slow"]);
    expect(results[0]).toBe(results[1]);
  } finally {
    await session.close();
  }
});

test("a failed later discovery page never becomes a partial catalog", async () => {
  const session = await connect(stdio("paged-failure"), { sessionTools: true });
  try {
    await expect(session.listTools()).rejects.toThrow("page failed");
    await expect(session.listTools()).rejects.toThrow("page failed");
  } finally {
    await session.close();
  }
});

test("MCP list_changed invalidates a cached session catalog including empty results", async () => {
  const session = await connect(stdio("dynamic"), { sessionTools: true });
  try {
    await Promise.all([session.listTools(), session.listTools()]);
    await session.listTools();
    expect((await session.callTool("change", {})).content).toEqual([{ type: "text", text: "1" }]);
    expect(await session.listTools()).toEqual([]);
  } finally {
    await session.close();
  }
});

test("MCP notifications during a discovery supersede its result", async () => {
  const session = await connect(stdio("race"), { sessionTools: true });
  try {
    expect(await session.listTools()).toEqual([]);
  } finally {
    await session.close();
  }
});

test("modern MCP connections subscribe to tool-list changes", async () => {
  const session = await connect(stdio("modern"), { sessionTools: true, timeoutMs: 1000 });
  try {
    expect((await session.listTools()).map(({ name }) => name)).toEqual(["echo", "slow"]);
    await session.callTool("change", {});
    expect(await session.listTools()).toEqual([]);
  } finally {
    await session.close();
  }
}, 5000);
