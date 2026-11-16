import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandCatalog, CommandNode } from "@mcp-cli/core";

const count = (node: CommandNode): number =>
  1 + node.children.reduce((total, child) => total + count(child), 0);

test("desktop commands prints a complete catalog larger than one pipe buffer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-commands-"));
  try {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", "desktop", "commands"], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ service: "notion" }));
    child.stdin.end();
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(65_536);
    const { result }: { result: CommandCatalog } = JSON.parse(stdout);
    expect(result.service).toBe("notion");
    expect(count(result.root)).toBeGreaterThan(20);
    expect(result.root.help).toStartWith("Usage: notion <command>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
