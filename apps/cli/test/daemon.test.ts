import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../src/daemon/pool";
import { startDaemon } from "../src/daemon/server";
import { daemonRequest, daemonStatus } from "../src/daemon/client";
import { request } from "node:http";
import { daemonDirectory, daemonSocket } from "../src/daemon/endpoint";
import { UsageError, type ToolSession, type ToolResult } from "@mcp-cli/core";
import { execute } from "../src/main";
import { discover, findPlugin, loadPlugin } from "../src/discovery";
import { defaultContext } from "../src/paths";
import { runtimeDependencies } from "../src/runtime";
import { memoryHost, runCli } from "./host";

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
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    XDG_STATE_HOME: directory,
    MCP_CLI_CONFIG: "",
    MCP_CLI_DAEMON_DIR: directory,
    MCP_CLI_DAEMON: "",
    MCP_CLI_INTERNAL_PLUGINS: "only",
  };
  const run = (...args: string[]) => runCli(args, { env });
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
});

test("Web API direct and daemon calls share auth, isolate tokens, and never require MCP", async () => {
  const { connect } = await import("@mcp-cli/mcp");
  const { default: demoAuth } = await import("../../../plugins/demo-auth/src");
  const directory = await mkdtemp(join(tmpdir(), "mcp-web-daemon-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const seen: string[] = [];
  const searches: Array<{ contentType: string | null; body: string }> = [];
  const api = Bun.serve({
    port: 0,
    fetch: async (req) => {
      seen.push(req.headers.get("authorization") ?? "");
      if (new URL(req.url).pathname === "/search.messages")
        searches.push({ contentType: req.headers.get("content-type"), body: await req.text() });
      return Response.json({ ok: true, user_id: "U0123456789" });
    },
  });
  const pluginEnv = { DEMO_AUTH_WEB_URL: String(api.url) };
  const configured = await demoAuth.connection(pluginEnv);
  if (configured.type !== "http" || !configured.webApi)
    throw new Error("demo-auth needs a Web API");
  const daemon = await startDaemon(directory);
  const context = {
    service: "demo-auth",
    cwd: directory,
    name: "web.auth.test",
    input: {},
    env: {
      ...pluginEnv,
      MCP_CLI_INTERNAL_PLUGINS: "1",
      XDG_CONFIG_HOME: directory,
      DEMO_AUTH_TOKEN: "user-fixture",
      DEMO_AUTH_BOT_TOKEN: "bot-fixture",
    },
  };
  const direct = await connect({
    type: "http",
    url: "http://127.0.0.1:1/mcp",
    headers: { Authorization: "Bearer user-fixture" },
    webApi: configured.webApi,
  });
  try {
    const expected = await direct.callTool("web.auth.test", {});
    expect(await daemonRequest<ToolResult>("callTool", context, directory)).toEqual(expected);
    const first = daemon.status()[0];
    await daemonRequest(
      "callTool",
      {
        ...context,
        credential: "user",
        cwd: root,
        env: { ...context.env, TERM: "different-shell" },
      },
      directory,
    );
    expect(daemon.status()).toHaveLength(1);
    expect(daemon.status()[0]?.id).toBe(first?.id);
    expect(daemon.status()[0]?.credential).toBe("user");
    await daemonRequest("callTool", { ...context, credential: "bot" }, directory);
    expect(seen).toEqual([
      "Bearer user-fixture",
      "Bearer user-fixture",
      "Bearer user-fixture",
      "Bearer bot-fixture",
    ]);
    expect(daemon.status()).toHaveLength(2);
    const input = { query: 'in:general "배포 완료" & +', count: 1, page: 2 };
    const search = await direct.callTool("web.search.messages", input);
    expect(
      await daemonRequest<ToolResult>(
        "callTool",
        { ...context, name: "web.search.messages", input },
        directory,
      ),
    ).toEqual(search);
    expect(searches).toHaveLength(2);
    for (const request of searches) {
      expect(request.contentType).toBe("application/x-www-form-urlencoded");
      expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
        query: input.query,
        count: "1",
        page: "2",
      });
    }
  } finally {
    await direct.close();
    await daemon.stop();
    api.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
  await expect(daemonRequest("callTool", context, directory)).rejects.toThrow();
});

test("daemon start serves until termination or IPC stop and cleans up through its finalizer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-command-"));
  const env = { HOME: directory, XDG_CONFIG_HOME: directory, MCP_CLI_DAEMON_DIR: directory };
  const start = () => {
    const memory = memoryHost({ env });
    let ready = () => {};
    const written = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const host = {
      ...memory.host,
      write: async (text: string) => {
        await memory.host.write(text);
        ready();
      },
    };
    return { memory, written, exit: execute(["daemon", "start", "--json"], host) };
  };
  try {
    const signalled = start();
    await signalled.written;
    expect(JSON.parse(signalled.memory.stdout())).toEqual({ event: "ready", pid: process.pid });
    const status = await runCli(["daemon", "status", "--json"], { env });
    expect(JSON.parse(status.stdout)).toMatchObject({ pid: process.pid, connections: [] });
    signalled.memory.terminate("SIGTERM");
    expect(await signalled.exit).toBe(0);
    await expect(readFile(join(directory, "token"))).rejects.toThrow();
    await expect(readFile(join(directory, "owner"))).rejects.toThrow();
    const stopped = start();
    await stopped.written;
    expect(await runCli(["daemon", "stop", "--json"], { env })).toEqual({
      stdout: "null\n",
      stderr: "",
      code: 0,
    });
    expect(await stopped.exit).toBe(0);
    expect(stopped.memory.stderr()).toBe("");
    await expect(readFile(join(directory, "owner"))).rejects.toThrow();
    expect((await runCli(["daemon", "recover"], { env })).code).toBe(0);
    expect((await runCli(["daemon", "bogus"], { env })).code).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("daemon mode defaults on and requires an explicit zero to bypass", async () => {
  const { usesDaemon } = await import("../src/daemon/client");
  expect(usesDaemon({})).toBe(true);
  expect(usesDaemon({ MCP_CLI_DAEMON: "" })).toBe(true);
  expect(usesDaemon({ MCP_CLI_DAEMON: "1" })).toBe(true);
  expect(usesDaemon({ MCP_CLI_DAEMON: "0" })).toBe(false);
  expect(() => usesDaemon({ MCP_CLI_DAEMON: "false" })).toThrow(UsageError);
});

test("CLI does not switch to direct execution after a daemon tool request fails", async () => {
  const { createServer } = await import("node:http");
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-failure-"));
  await writeFile(join(directory, "token"), "fixture-ipc-token", { mode: 0o600 });
  const operations: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    const value: unknown = JSON.parse(body);
    const operation =
      typeof value === "object" && value !== null && "operation" in value
        ? String(value.operation)
        : "";
    operations.push(operation);
    res.setHeader("content-type", "application/json");
    if (operation === "ensure") res.end(JSON.stringify({ result: null }));
    else
      res.writeHead(500).end(JSON.stringify({ code: "Error", message: "write outcome unknown" }));
  });
  await new Promise<void>((resolve) => server.listen(daemonSocket(directory), resolve));
  try {
    const { stdout, stderr, code } = await runCli(
      ["demo", "message", "echo", "--text", "must-not-run-directly"],
      {
        env: {
          MCP_CLI_DAEMON: "",
          MCP_CLI_DAEMON_DIR: directory,
          XDG_CONFIG_HOME: directory,
          XDG_STATE_HOME: directory,
          XDG_CACHE_HOME: directory,
          MCP_CLI_CONFIG: "",
          MCP_CLI_INTERNAL_PLUGINS: "only",
        },
      },
    );
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("write outcome unknown");
    expect(operations).toEqual(["ensure", "callTool"]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("the daemon directory follows the host HOME unless MCP_CLI_DAEMON_DIR is set", () => {
  expect(daemonDirectory({ HOME: "/sandbox" })).toBe(join("/sandbox", ".mcp-cli", "daemon"));
  expect(daemonDirectory({ HOME: "/sandbox", MCP_CLI_DAEMON_DIR: "/d" })).toBe("/d");
});

test("a runtime without the daemon connects directly to plugins the daemon cannot find", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-daemon-"));
  const daemon = await startDaemon(directory);
  const env = {
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    XDG_STATE_HOME: directory,
    MCP_CLI_CONFIG: "",
    MCP_CLI_DAEMON_DIR: directory,
    MCP_CLI_DAEMON: "",
    MCP_CLI_INTERNAL_PLUGINS: "only",
  };
  const { host } = memoryHost({ env });
  const registry = await discover(await defaultContext(env));
  // A renamed demo plugin stands in for a workspace-only plugin that a release daemon never discovers.
  const local = {
    ...(await loadPlugin(findPlugin(registry, "demo"), registry.context)),
    name: "local",
  };
  try {
    const shared = await runtimeDependencies(local, host).forWorkspace?.(undefined);
    await expect(shared?.open()).rejects.toThrow("Unknown service: local");
    const direct = await runtimeDependencies(local, host, undefined, false).forWorkspace?.(
      undefined,
    );
    const session = await direct?.open();
    try {
      expect((await session?.listTools())?.map((tool) => tool.name)).toContain("demo-echo");
    } finally {
      await session?.close();
    }
    expect((await daemonStatus(directory)).connections).toEqual([]);
  } finally {
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
