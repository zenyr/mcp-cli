import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./host";

test("linked commands share daemon selection and fall back when it is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-linked-"));
  const execute = async (args: string[], mode?: string) => {
    const env = {
      HOME: directory,
      MCP_CLI_DAEMON_DIR: directory,
      XDG_STATE_HOME: directory,
      XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory,
      MCP_CLI_CONFIG: "",
      MCP_CLI_INTERNAL_PLUGINS: "only",
      ...(mode !== undefined && { MCP_CLI_DAEMON: mode }),
    };
    const result = await runCli(args, { env });
    return { code: result.code, output: result.stdout, error: result.stderr };
  };
  try {
    // Service bins are generated wrappers of the same entry point; lint checks them with sync-bins.
    const invalid = await execute(["demo", "resources", "list"], "invalid");
    expect(invalid.code).toBe(2);
    expect(invalid.error).toContain("MCP_CLI_DAEMON must be 0 or 1");
    expect((await execute(["--help"])).code).toBe(0);
    const fallback = await execute(["demo", "resources", "list"]);
    expect(fallback.code).toBe(0);
    expect(fallback.output).toContain("demo://readme");
    const direct = await execute(["demo", "message", "echo", "--text", "linked"], "0");
    expect(direct.code).toBe(0);
    expect(direct.output).toContain("linked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
