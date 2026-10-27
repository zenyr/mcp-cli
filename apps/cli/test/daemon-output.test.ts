import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("daemon JSON responses remain single-line frames for desktop clients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-output-"));
  const options = {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: directory,
      MCP_CLI_CONFIG: "",
      MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
    },
    stdout: "pipe",
    stderr: "pipe",
  } as const;
  const command = [process.execPath, "apps/cli/src/main.ts"];
  const frame = (output: string): unknown => {
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] ?? "");
  };
  const run = async (...args: string[]) => {
    const child = Bun.spawn([...command, ...args], options);
    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, error).toBe(0);
    return output;
  };
  const daemon = Bun.spawn([...command, "daemon", "start", "--json"], options);
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
