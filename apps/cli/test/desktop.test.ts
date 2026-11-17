import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot, runCli } from "./host";

test("desktop API key operations share CLI storage without printing secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-auth-"));
  const pluginDir = join(directory, "plugin");
  await mkdir(pluginDir);
  await Bun.write(
    join(pluginDir, "package.json"),
    JSON.stringify({
      name: "desktop-test-plugin",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "desktop-test" },
    }),
  );
  await Bun.write(
    join(pluginDir, "index.ts"),
    `export default { name: "desktop-test", summary: "Test", auth: { type: "apiKey", env: "DESKTOP_TEST_KEY", alternates: [{ flag: "user", base: true, env: "DESKTOP_TEST_KEY", summary: "User" }, { flag: "bot", env: "DESKTOP_TEST_BOT", summary: "Bot" }] }, connection: () => ({ type: "http", url: "http://127.0.0.1:1/mcp" }) };`,
  );
  const config = join(directory, "config.json");
  await Bun.write(config, JSON.stringify({ plugins: [pluginDir] }));
  const run = (action: string, input?: unknown, framed = false) =>
    runCli(["desktop", action], {
      env: {
        ...process.env,
        HOME: directory,
        MCP_CLI_CONFIG: config,
        XDG_CONFIG_HOME: directory,
        XDG_STATE_HOME: directory,
        MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
        DESKTOP_TEST_KEY: "",
        DESKTOP_TEST_BOT: "",
      },
      stdin: JSON.stringify(input ?? {}) + (framed ? "\n" : ""),
    });
  try {
    const saved = await run("login", {
      service: "desktop-test",
      credential: "bot",
      secret: "fixture-private-key",
    });
    expect(saved).toEqual({ stdout: '{"result":null}\n', stderr: "", code: 0 });
    expect(
      (await run("login", { service: "desktop-test", secret: "framed-fixture-key" }, true)).code,
    ).toBe(0);
    const listed = await run("services");
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('"flag":"bot","summary":"Bot","stored":true');
    expect(listed.stdout).not.toContain("fixture-private-key");
    expect(listed.stdout).toContain(
      '"name":"desktop-test","summary":"Test","auth":"apiKey","credentials":[{"flag":"user"',
    );
    expect(listed.stdout).toContain('"flag":"user","summary":"User","stored":true');
    expect((await run("logout", { service: "desktop-test", credential: "user" })).code).toBe(0);
    const afterUserLogout = await run("services");
    expect(afterUserLogout.stdout).toContain('"flag":"user","summary":"User","stored":false');
    expect(afterUserLogout.stdout).toContain('"flag":"bot","summary":"Bot","stored":true');
    expect(
      (await run("login", { service: "desktop-test", credential: "invalid", secret: "x" })).code,
    ).toBe(2);
    expect((await run("logout", { service: "desktop-test", credential: "bot" })).code).toBe(0);
    expect((await run("services")).stdout).toContain('"flag":"bot","summary":"Bot","stored":false');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop requests fail when stdin closes before a complete JSON request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-eof-"));
  try {
    const env = { HOME: directory, XDG_CONFIG_HOME: directory, MCP_CLI_DAEMON: "0" };
    for (const stdin of ["", '{"service":'])
      expect(await runCli(["desktop", "login"], { env, stdin })).toEqual({
        stdout: "",
        stderr: "JSON Parse error: Unexpected EOF\n",
        code: 1,
      });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// A real process is required because the desktop app keeps stdin open after sending one request.
test("desktop requests finish while the desktop app keeps stdin open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-open-"));
  try {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", "desktop", "auth-status"], {
      cwd: repositoryRoot,
      env: {
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        MCP_CLI_DAEMON: "0",
        MCP_CLI_INTERNAL_PLUGINS: "only",
        PATH: process.env.PATH ?? "",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(`${JSON.stringify({ service: "demo-auth" })}\n`);
    await child.stdin.flush();
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(stdout).toStartWith('{"result":');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
