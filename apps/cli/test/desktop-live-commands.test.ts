import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandCatalog } from "@mcp-cli/core";
import { runCli } from "./host";

test("desktop commands lists a session plugin's live tools on request", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-live-commands-"));
  try {
    const plugin = join(root, "plugin");
    await mkdir(plugin);
    const server = join(import.meta.dir, "../../../packages/mcp/test/fixtures/server.ts");
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({
        name: "live-test",
        type: "module",
        exports: "./index.ts",
        "mcp-cli": { plugin: true, service: "live-test" },
      }),
    );
    await writeFile(
      join(plugin, "index.ts"),
      `export default {name:"live-test",summary:"Live test",discovery:{tools:"session"},connection:()=>({type:"stdio",command:${JSON.stringify(process.execPath)},args:[${JSON.stringify(server)},"dynamic"]})};`,
    );
    const config = join(root, "config.json");
    await writeFile(config, JSON.stringify({ plugins: [plugin] }));
    const run = (input: unknown) =>
      runCli(["desktop", "commands"], {
        env: {
          HOME: root,
          MCP_CLI_CONFIG: config,
          MCP_CLI_INTERNAL_PLUGINS: "only",
          XDG_CONFIG_HOME: root,
          XDG_CACHE_HOME: root,
          XDG_STATE_HOME: root,
          MCP_CLI_DAEMON: "0",
          MCP_CLI_DAEMON_DIR: join(root, "daemon"),
        },
        stdin: JSON.stringify(input),
      });
    const live = await run({ service: "live-test", live: true });
    expect(live.stderr).toBe("");
    const { result }: { result: CommandCatalog } = JSON.parse(live.stdout);
    expect(result).toMatchObject({ service: "live-test", origin: "live", discovery: true });
    expect(result.fetchedAt).toBeNumber();
    const call = result.root.children.find((node) => node.path.join(" ") === "call");
    expect(call?.children.map((node) => node.path.join(" "))).toEqual(["call echo", "call slow"]);
    expect(call?.help).toContain("Tools:");
    expect(call?.children[0]?.help).toStartWith("Usage: live-test call echo [options]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
