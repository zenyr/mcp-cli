import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "@mcp-cli/core";
import { daemonRequest } from "../src/daemon/client";
import { startDaemon } from "../src/daemon/server";
import { discover, findPlugin, loadPlugin } from "../src/discovery";
import { defaultContext } from "../src/paths";
import { runtimeDependencies } from "../src/runtime";
import { memoryHost } from "./host";

const server = join(import.meta.dir, "../../../packages/mcp/test/fixtures/server.ts");

// Each fixture plugin reports the child's caller probe, plugin env, and working directory.
const writePlugin = async (root: string, service: string, isolatedEnv: boolean) => {
  const dir = join(root, service);
  await mkdir(dir);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: service,
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service },
    }),
  );
  const connection = {
    type: "stdio",
    command: process.execPath,
    args: [server],
    env: { FIXTURE_CONFIG: "plugin" },
    isolatedEnv,
  };
  await writeFile(
    join(dir, "index.ts"),
    `export default {name:${JSON.stringify(service)},summary:"test",connection:()=>(${JSON.stringify(connection)})};`,
  );
  return dir;
};

const childEnv = (result: ToolResult): unknown => {
  const text = result.content[0]?.text;
  return typeof text === "string" ? JSON.parse(text) : undefined;
};

test("daemon and direct paths start stdio servers with the same env and cwd", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "stdio-env-")));
  const config = join(root, "config.json");
  const plugins = [
    await writePlugin(root, "env-shared", false),
    await writePlugin(root, "env-isolated", true),
  ];
  await writeFile(config, JSON.stringify({ plugins }));
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: root,
    XDG_STATE_HOME: root,
    XDG_CACHE_HOME: root,
    MCP_CLI_CONFIG: config,
    MCP_CLI_DAEMON: "0",
    MCP_CLI_INTERNAL_PLUGINS: "only",
    PATH: process.env.PATH ?? "",
    FIXTURE_PROBE: "caller",
  };
  const daemon = await startDaemon(root);
  const viaDaemon = async (service: string) =>
    childEnv(
      await daemonRequest<ToolResult>(
        "callTool",
        { service, cwd: root, name: "env", input: {}, env },
        root,
      ),
    );
  const direct = async (service: string) => {
    const registry = await discover(await defaultContext(env));
    const plugin = await loadPlugin(findPlugin(registry, service), registry.context);
    const host = memoryHost({ env, cwd: root }).host;
    const scoped = await runtimeDependencies(plugin, host).forWorkspace?.(undefined);
    if (!scoped) throw new Error("runtime dependencies must select a workspace");
    const session = await scoped.open(undefined);
    try {
      return childEnv(await session.callTool("env", {}));
    } finally {
      await session.close();
    }
  };
  try {
    const shared = { FIXTURE_PROBE: "caller", FIXTURE_CONFIG: "plugin", cwd: root };
    expect(await viaDaemon("env-shared")).toEqual(shared);
    expect(await direct("env-shared")).toEqual(shared);
    const isolated = { ...shared, FIXTURE_PROBE: null };
    expect(await viaDaemon("env-isolated")).toEqual(isolated);
    expect(await direct("env-isolated")).toEqual(isolated);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});
