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
import { UsageError, type ToolSession, type ToolResult } from "@mcp-cli/core";

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
    MCP_CLI_DAEMON: "",
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

test("Web API direct and daemon calls share auth, isolate tokens, and never require MCP", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { connect } = await import("@mcp-cli/mcp");
  const { webTools } = await import("../../../plugins/slack/src/web-methods");
  const directory = await mkdtemp(join(tmpdir(), "mcp-web-daemon-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const seen: string[] = [];
  const api = Bun.serve({
    port: 0,
    fetch: async (req) => {
      seen.push(req.headers.get("authorization") ?? "");
      return Response.json({ ok: true, user_id: "U0123456789" });
    },
  });
  const pluginDir = join(directory, "plugin");
  await mkdir(pluginDir);
  await writeFile(
    join(pluginDir, "package.json"),
    JSON.stringify({
      name: "slack-test",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "slack-test" },
    }),
  );
  await writeFile(
    join(pluginDir, "index.ts"),
    `import slack from ${JSON.stringify(join(root, "plugins/slack/src/index.ts"))};\nexport default {...slack,name:"slack-test",connection:async(env)=>{const config=await slack.connection(env);return {...config,url:"http://127.0.0.1:1/mcp",webApi:{...config.webApi,url:${JSON.stringify(String(api.url))}}}}};\n`,
  );
  const configFile = join(directory, "config.json");
  await writeFile(configFile, JSON.stringify({ plugins: [pluginDir] }));
  const daemon = await startDaemon(directory);
  const context = {
    service: "slack-test",
    cwd: directory,
    name: "web.auth.test",
    input: {},
    env: {
      MCP_CLI_CONFIG: configFile,
      XDG_CONFIG_HOME: directory,
      SLACK_MCP_TOKEN: "xoxp-fixture",
      SLACK_MCP_BOT_TOKEN: "xoxb-fixture",
    },
  };
  const direct = await connect({
    type: "http",
    url: "http://127.0.0.1:1/mcp",
    headers: { Authorization: "Bearer xoxp-fixture" },
    webApi: { url: String(api.url), tools: webTools },
  });
  try {
    const expected = await direct.callTool("web.auth.test", {});
    expect(await daemonRequest<ToolResult>("callTool", context, directory)).toEqual(expected);
    await daemonRequest("callTool", { ...context, credential: "xoxb" }, directory);
    expect(seen).toEqual(["Bearer xoxp-fixture", "Bearer xoxp-fixture", "Bearer xoxb-fixture"]);
    expect(daemon.status()).toHaveLength(2);
  } finally {
    await direct.close();
    await daemon.stop();
    api.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
  await expect(daemonRequest("callTool", context, directory)).rejects.toThrow();
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
    const child = Bun.spawn(
      [
        process.execPath,
        "apps/cli/src/main.ts",
        "demo",
        "message",
        "echo",
        "--text",
        "must-not-run-directly",
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: {
          ...process.env,
          MCP_CLI_DAEMON: "",
          MCP_CLI_DAEMON_DIR: directory,
          XDG_CONFIG_HOME: directory,
          XDG_STATE_HOME: directory,
          XDG_CACHE_HOME: directory,
          MCP_CLI_CONFIG: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
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
