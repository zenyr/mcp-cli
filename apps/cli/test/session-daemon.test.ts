import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition, ToolResult } from "@mcp-cli/core";
import { daemonRequest } from "../src/daemon/client";
import { startDaemon } from "../src/daemon/server";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "session-daemon-"));
  const plugin = join(root, "plugin");
  await mkdir(plugin);
  const server = join(import.meta.dir, "../../../packages/mcp/test/fixtures/server.ts");
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "session-test",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "session-test" },
    }),
  );
  await writeFile(
    join(plugin, "index.ts"),
    `export default {name:"session-test",summary:"test",discovery:{tools:"session"},connection:()=>({type:"stdio",command:${JSON.stringify(process.execPath)},args:[${JSON.stringify(server)},"dynamic"]})};`,
  );
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ plugins: [plugin] }));
  const daemon = await startDaemon(root);
  const payload = {
    service: "session-test",
    cwd: root,
    name: "",
    input: {},
    env: { MCP_CLI_CONFIG: config, HOME: root, PATH: process.env.PATH ?? "" },
  };
  return { root, daemon, payload };
};

test("daemon catalogs single-flight across clients, invalidate, and rediscover after reset", async () => {
  const f = await fixture();
  try {
    const lists = await Promise.all([
      daemonRequest<ToolDefinition[]>("listTools", f.payload, f.root),
      daemonRequest<ToolDefinition[]>("listTools", f.payload, f.root),
    ]);
    expect(lists.map((tools) => tools.map(({ name }) => name))).toEqual([
      ["echo", "slow"],
      ["echo", "slow"],
    ]);
    const changed = await daemonRequest<ToolResult>(
      "callTool",
      { ...f.payload, name: "change" },
      f.root,
    );
    expect(changed.content).toEqual([{ type: "text", text: "1" }]);
    expect(await daemonRequest<ToolDefinition[]>("listTools", f.payload, f.root)).toEqual([]);
    await daemonRequest("reset", {}, f.root);
    expect(
      (await daemonRequest<ToolDefinition[]>("listTools", f.payload, f.root)).map(
        ({ name }) => name,
      ),
    ).toEqual(["echo", "slow"]);
  } finally {
    await f.daemon.stop();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("bound discovery cannot dispatch through a replacement connection", async () => {
  const f = await fixture();
  try {
    const { connectionId } = await daemonRequest<{ connectionId: string }>(
      "ensure",
      f.payload,
      f.root,
    );
    await daemonRequest("listTools", { ...f.payload, connectionId }, f.root);
    await daemonRequest("reset", {}, f.root);
    await expect(
      daemonRequest(
        "callTool",
        { ...f.payload, connectionId, name: "echo", input: { text: "must not run" } },
        f.root,
      ),
    ).rejects.toThrow("Discovery connection changed");
  } finally {
    await f.daemon.stop();
    await rm(f.root, { recursive: true, force: true });
  }
});
