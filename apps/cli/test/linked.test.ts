import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");

test("linked commands require the daemon by default and allow direct connections", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-linked-"));
  const execute = async (bin: string, args: string[], mode?: string) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_CLI_DAEMON_DIR: directory,
      XDG_STATE_HOME: directory,
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
    for (const bin of ["mcp-cli", "slack", "notion", "linear", "fish-audio"]) {
      const args = bin === "mcp-cli" ? ["demo", "resources", "list"] : ["resources", "list"];
      const result = await execute(bin, args);
      expect(result.code).toBe(1);
      expect(result.error).toContain(join(directory, "token"));
      expect((await execute(bin, ["--help"])).code).toBe(0);
    }
    const direct = await execute("mcp-cli", ["demo", "message", "echo", "--text", "linked"], "0");
    expect(direct.code).toBe(0);
    expect(direct.output).toContain("linked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
