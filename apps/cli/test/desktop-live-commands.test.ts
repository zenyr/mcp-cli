import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandCatalog } from "@mcp-cli/core";

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
    const run = async (input: unknown) => {
      // Spawns a real process because runtimeDependencies still reads process.env to choose the daemon.
      const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", "desktop", "commands"], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          HOME: root,
          MCP_CLI_CONFIG: config,
          XDG_CONFIG_HOME: root,
          XDG_STATE_HOME: root,
          MCP_CLI_DAEMON: "0",
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };
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
