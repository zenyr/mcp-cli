import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
    `export default { name: "desktop-test", summary: "Test", auth: { type: "apiKey", env: "DESKTOP_TEST_KEY", alternates: [{ flag: "bot", env: "DESKTOP_TEST_BOT", summary: "Bot" }] }, connection: () => ({ type: "http", url: "http://127.0.0.1:1/mcp" }) };`,
  );
  const config = join(directory, "config.json");
  await Bun.write(config, JSON.stringify({ plugins: [pluginDir] }));
  const run = async (action: string, input?: unknown) => {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", "desktop", action], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
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
      stdin: new Blob([JSON.stringify(input ?? {})]),
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
    const saved = await run("login", {
      service: "desktop-test",
      credential: "bot",
      secret: "fixture-private-key",
    });
    expect(saved).toEqual({ stdout: '{"result":null}\n', stderr: "", code: 0 });
    const listed = await run("services");
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('"flag":"bot","summary":"Bot","stored":true');
    expect(listed.stdout).not.toContain("fixture-private-key");
    expect(
      (await run("login", { service: "desktop-test", credential: "invalid", secret: "x" })).code,
    ).toBe(2);
    expect((await run("logout", { service: "desktop-test", credential: "bot" })).code).toBe(0);
    expect((await run("services")).stdout).toContain('"flag":"bot","summary":"Bot","stored":false');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
