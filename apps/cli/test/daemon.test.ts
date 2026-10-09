import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../src/daemon/pool";
import { startDaemon } from "../src/daemon/server";
import { daemonRequest, daemonStatus } from "../src/daemon/client";
import { request } from "node:http";
import { daemonSocket } from "../src/daemon/endpoint";
import type { ToolSession } from "@mcp-cli/core";

const session = (close: () => Promise<void>): ToolSession => ({
  listTools: async () => [],
  callTool: async () => ({ content: [] }),
  listResources: async () => [],
  listResourceTemplates: async () => [],
  readResource: async () => [],
  listPrompts: async () => [],
  getPrompt: async () => ({ messages: [] }),
  close,
});
const deferred = () => {
  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
};

test("IPC endpoints use Windows named pipes and POSIX sockets", () => {
  const pipe = daemonSocket("C:\\Users\\test\\daemon", "win32");
  expect(pipe.startsWith(String.raw`\\.\pipe\mcp-cli-`)).toBe(true);
  expect(pipe.slice(String.raw`\\.\pipe\mcp-cli-`.length)).toMatch(/^[a-f0-9]{24}$/);
  expect(daemonSocket("/tmp/daemon", "linux")).toBe("/tmp/daemon/daemon.sock");
});

test("pool shares concurrent opens, isolates keys, and expires idle sessions", async () => {
  const expired = deferred();
  const pool = createPool(10);
  let opens = 0;
  const open = async () => {
    opens += 1;
    return session(async () => {
      expired.finish();
    });
  };
  await Promise.all([
    pool.use("a", "demo", open, async () => 1),
    pool.use("a", "demo", open, async () => 2),
  ]);
  expect(opens).toBe(1);
  await pool.use("b", "demo", open, async () => 3);
  expect(opens).toBe(2);
  await expired.promise;
  await pool.reset(true);
  expect(pool.status()).toEqual([]);
});

test("CLI leases keep connections alive until release", async () => {
  const closed = deferred();
  const pool = createPool(1);
  const open = async () =>
    session(async () => {
      closed.finish();
    });
  const release = await pool.use("lease", "demo", open, async () => pool.retain("lease"));
  expect(pool.status()[0]?.leases).toBe(1);
  expect(pool.status()[0]?.active).toBe(0);
  release();
  release();
  expect(pool.status()[0]?.leases).toBe(0);
  await closed.promise;
  expect(pool.status()).toEqual([]);
  await pool.reset(true);
});

test("reset drains active calls and failed calls never retry", async () => {
  const pool = createPool();
  const started = deferred();
  const complete = deferred();
  let closes = 0;
  const open = async () =>
    session(async () => {
      closes += 1;
    });
  const call = pool.use("a", "demo", open, async () => {
    started.finish();
    await complete.promise;
    return 7;
  });
  await started.promise;
  const reset = pool.reset();
  expect(closes).toBe(0);
  complete.finish();
  expect(await call).toBe(7);
  await reset;
  expect(closes).toBe(1);
  let calls = 0;
  await expect(
    pool.use("a", "demo", open, async () => {
      calls += 1;
      throw new Error("lost reply");
    }),
  ).rejects.toThrow("lost reply");
  await pool.reset(true);
  expect(calls).toBe(1);
  expect(closes).toBe(2);
  await expect(pool.use("a", "demo", open, async () => 1)).rejects.toThrow("stopping");
});

test("daemon preserves CLI output, reuses connections, rejects unauthenticated IPC, and cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-"));
  const daemon = await startDaemon(directory);
  const env = {
    ...process.env,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    XDG_STATE_HOME: directory,
    MCP_CLI_CONFIG: "",
    MCP_CLI_DAEMON_DIR: directory,
    MCP_CLI_DAEMON: "1",
  };
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", ...args], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  };
  try {
    expect(await run("demo", "message", "echo", "--text", "one")).toEqual({
      stdout: "one\n",
      stderr: "",
      code: 0,
    });
    expect(await run("demo", "message", "echo", "--text", "two")).toEqual({
      stdout: "two\n",
      stderr: "",
      code: 0,
    });
    expect((await daemonStatus(directory)).connections).toHaveLength(1);
    expect((await run("demo", "--help")).code).toBe(0);
    expect((await run("demo", "message", "fail")).code).toBe(1);
    await expect(startDaemon(directory)).rejects.toThrow();
    const forbidden = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        { socketPath: daemonSocket(directory), method: "POST", path: "/" },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(forbidden).toBe(403);
    await daemonRequest("reset", {}, directory);
    expect((await daemonStatus(directory)).connections).toEqual([]);
  } finally {
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
  await expect(readFile(`${directory}/token`)).rejects.toThrow();
}, 20_000);
