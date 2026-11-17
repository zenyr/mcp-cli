import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./host";

test("daemon JSON responses remain single-line frames for desktop clients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-output-"));
  const env = {
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    MCP_CLI_CONFIG: "",
    MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
  };
  const frame = (output: string): unknown => {
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] ?? "");
  };
  const run = async (...args: string[]) => {
    const result = await runCli(args, { env });
    expect(result.code, result.stderr).toBe(0);
    return result.stdout;
  };
  // The ready frame must arrive over a real stdout pipe, and IPC stop must end a real process.
  const daemon = Bun.spawn(
    [process.execPath, "apps/cli/src/main.ts", "daemon", "start", "--json"],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const errors = new Response(daemon.stderr).text();
  try {
    const ready = await daemon.stdout.getReader().read();
    expect(frame(new TextDecoder().decode(ready.value))).toMatchObject({
      event: "ready",
      pid: daemon.pid,
    });
    expect(frame(await run("daemon", "status", "--json"))).toMatchObject({
      pid: daemon.pid,
      connections: [],
    });
    expect(frame(await run("--json", "daemon", "status"))).toHaveProperty("pid", daemon.pid);
    expect(await run("daemon", "status")).toContain(`pid: ${daemon.pid}\n`);
    expect(frame(await run("daemon", "reset", "--json"))).toBeNull();
    expect(frame(await run("daemon", "stop", "--json"))).toBeNull();
    expect(await daemon.exited, await errors).toBe(0);
  } finally {
    if (daemon.exitCode === null) daemon.kill("SIGTERM");
    await daemon.exited;
    await rm(directory, { recursive: true, force: true });
  }
});
