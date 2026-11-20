import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Agent, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonRequest } from "../src/daemon/client";
import { daemonSocket } from "../src/daemon/endpoint";
import { startDaemon } from "../src/daemon/server";

const server = join(import.meta.dir, "../../../packages/mcp/test/fixtures/server.ts");

// The first stdio spawn signals `started`, then blocks on the `gate` FIFO until the test opens it.
const gatedFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "daemon-lease-"));
  const plugin = join(root, "plugin");
  const started = join(root, "started");
  const gate = join(root, "gate");
  await mkdir(plugin);
  expect(Bun.spawnSync(["mkfifo", started, gate]).exitCode).toBe(0);
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "gated",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "gated" },
    }),
  );
  const args = [
    "-c",
    'if mkdir "$5" 2>/dev/null; then echo > "$1"; cat "$2" > /dev/null; fi; exec "$3" "$4"',
    "sh",
    started,
    gate,
    process.execPath,
    server,
    join(root, "gated-once"),
  ];
  await writeFile(
    join(plugin, "index.ts"),
    `export default {name:"gated",summary:"test",connection:()=>({type:"stdio",command:"/bin/sh",args:${JSON.stringify(args)}})};`,
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
  return { root, daemon, payload, started, gate };
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
    await readFile(f.started);
    aborted.destroy();
    // A full round trip lets the daemon observe the closed socket before the connect finishes.
    await daemonRequest("status", {}, f.root);
    await writeFile(f.gate, "");
    await daemonRequest("ensure", f.payload, f.root, agent);
    expect(f.daemon.status()).toMatchObject([{ active: 0, leases: 1 }]);
    agent.destroy();
    await daemonRequest("status", {}, f.root);
    expect(f.daemon.status()).toMatchObject([{ active: 0, leases: 0 }]);
  } finally {
    agent.destroy();
    await f.daemon.stop();
    await rm(f.root, { recursive: true, force: true });
  }
});
