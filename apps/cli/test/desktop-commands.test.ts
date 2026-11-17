import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandCatalog, CommandNode } from "@mcp-cli/core";

const count = (node: CommandNode): number =>
  1 + node.children.reduce((total, child) => total + count(child), 0);

const largeCatalog = (tools: number) => ({
  version: 2,
  service: "large-catalog",
  tools: Array.from({ length: tools }, (_, index) => ({
    name: `tool-${index}`,
    description: `Fixture tool ${index}. ${"Long description text. ".repeat(20)}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A query string ".repeat(10) },
        limit: { type: "integer", description: "Maximum results ".repeat(10) },
      },
    },
  })),
});

test("desktop commands prints a complete catalog larger than one pipe buffer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-commands-"));
  const plugin = join(directory, "plugin");
  try {
    await mkdir(join(plugin, "src"), { recursive: true });
    await Bun.write(
      join(plugin, "package.json"),
      JSON.stringify({
        name: "large-catalog",
        type: "module",
        exports: "./index.ts",
        "mcp-cli": { plugin: true, service: "large-catalog" },
      }),
    );
    await Bun.write(
      join(plugin, "index.ts"),
      'export default { name: "large-catalog", summary: "Large catalog fixture", connection: () => ({ type: "stdio", command: "unused" }) };',
    );
    await Bun.write(
      join(plugin, "src/generated.ts"),
      `export const manifest = ${JSON.stringify(largeCatalog(120))};`,
    );
    const config = join(directory, "config.json");
    await Bun.write(config, JSON.stringify({ plugins: [plugin] }));
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", "desktop", "commands"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory, MCP_CLI_CONFIG: config },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ service: "large-catalog" }));
    child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(stdout.length).toBeGreaterThan(65_536);
    const { result }: { result: CommandCatalog } = JSON.parse(stdout);
    expect(result.service).toBe("large-catalog");
    expect(count(result.root)).toBeGreaterThan(20);
    expect(result.root.help).toStartWith("Usage: large-catalog <command>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
