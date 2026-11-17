import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");

test("linked commands share daemon selection and fall back when it is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-linked-"));
  const execute = async (bin: string, args: string[], mode?: string) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_CLI_DAEMON_DIR: directory,
      XDG_STATE_HOME: directory,
      XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory,
      MCP_CLI_CONFIG: "",
    };
    delete env.MCP_CLI_DAEMON;
    if (mode !== undefined) env.MCP_CLI_DAEMON = mode;
    const child = Bun.spawn([process.execPath, join(root, "bin", `${bin}.ts`), ...args], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: await child.exited,
      output: await new Response(child.stdout).text(),
      error: await new Response(child.stderr).text(),
    };
  };
  try {
    // Service bins are generated wrappers of this entry point; lint checks them with sync-bins.
    const invalid = await execute("mcp-cli", ["demo", "resources", "list"], "invalid");
    expect(invalid.code).toBe(2);
    expect(invalid.error).toContain("MCP_CLI_DAEMON must be 0 or 1");
    expect((await execute("mcp-cli", ["--help"])).code).toBe(0);
    const fallback = await execute("mcp-cli", ["demo", "resources", "list"]);
    expect(fallback.code).toBe(0);
    expect(fallback.output).toContain("demo://readme");
    const direct = await execute("mcp-cli", ["demo", "message", "echo", "--text", "linked"], "0");
    expect(direct.code).toBe(0);
    expect(direct.output).toContain("linked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
