import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Agent, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "@mcp-cli/core";
import { daemonRequest } from "../src/daemon/client";
import { daemonSocket } from "../src/daemon/endpoint";
import { startDaemon } from "../src/daemon/server";

const rpc = (id: unknown, result: Record<string, unknown>) =>
  Response.json({ jsonrpc: "2.0", id, result });

// An in-process legacy MCP server whose `initialize` reply waits until the test opens the gate.
const gatedServer = () => {
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (incoming) => {
      if (incoming.method !== "POST") return new Response(null, { status: 405 });
      const message: unknown = await incoming.json();
      if (!isRecord(message) || message.id === undefined)
        return new Response(null, { status: 202 });
      const { id, method } = message;
      if (method === "initialize") {
        started.resolve();
        await gate.promise;
        return rpc(id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "gated", version: "1.0.0" },
        });
      }
      if (method === "tools/list") return rpc(id, { tools: [] });
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Not found" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/mcp`, started, gate, server };
};

const gatedFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "daemon-lease-"));
  const plugin = join(root, "plugin");
  const mcp = gatedServer();
  await mkdir(plugin);
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "gated",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "gated" },
    }),
  );
  await writeFile(
    join(plugin, "index.ts"),
    `export default {name:"gated",summary:"test",connection:()=>({type:"http",url:${JSON.stringify(mcp.url)}})};`,
  );
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ plugins: [plugin] }));
  const daemon = await startDaemon(root);
  const payload = {
    service: "gated",
    cwd: root,
    name: "",
    input: {},
    env: { MCP_CLI_CONFIG: config, HOME: root, PATH: process.env.PATH ?? "" },
  };
  return { root, daemon, payload, mcp };
};

test("a client that closes during a slow connect leaves no lease behind", async () => {
  const f = await gatedFixture();
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const token = await readFile(join(f.root, "token"), "utf8");
    const aborted = request({
      socketPath: daemonSocket(f.root),
      path: "/",
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    aborted.on("error", () => undefined);
    aborted.end(JSON.stringify({ ...f.payload, operation: "ensure" }));
    await f.mcp.started.promise;
    aborted.destroy();
    // A full round trip lets the daemon observe the closed socket before the connect finishes.
    await daemonRequest("status", {}, f.root);
    f.mcp.gate.resolve();
    await daemonRequest("ensure", f.payload, f.root, agent);
    expect(f.daemon.status()).toMatchObject([{ active: 0, leases: 1 }]);
    agent.destroy();
    await daemonRequest("status", {}, f.root);
    expect(f.daemon.status()).toMatchObject([{ active: 0, leases: 0 }]);
  } finally {
    f.mcp.gate.resolve();
    agent.destroy();
    await f.daemon.stop();
    await f.mcp.server.stop(true);
    await rm(f.root, { recursive: true, force: true });
  }
});
