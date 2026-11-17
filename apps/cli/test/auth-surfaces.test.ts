import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("CLI and desktop share auth settings and token storage without silent browser fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auth-surfaces-"));
  const token = randomUUID();
  const invoke = async (args: string[], input?: unknown) => {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", ...args], {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: {
        ...process.env,
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        MCP_CLI_CONFIG: "",
        MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
        DEMO_AUTH_TOKEN: "",
        DEMO_AUTH_BOT_TOKEN: "",
      },
      stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stdout + stderr).not.toContain(token);
    return { code, stdout, stderr };
  };
  try {
    const configuration = { mcp: { method: "token" }, web: { method: "pkce", pkceEnabled: false } };
    expect((await invoke(["auth", "configure", "demo-auth"], configuration)).code).toBe(0);
    const cli = await invoke(["auth", "status", "demo-auth", "--json"]);
    expect(cli.code).toBe(0);
    const desktop = await invoke(["desktop", "services"]);
    expect(desktop.code).toBe(0);
    const services = JSON.parse(desktop.stdout).result;
    expect(
      services.find((item: { name: string }) => item.name === "demo-auth").authentication,
    ).toEqual(JSON.parse(cli.stdout));
    const rejected = await invoke(["desktop", "login"], {
      service: "demo-auth",
      target: "web",
      method: "browser",
    });
    expect(rejected.code).toBe(2);
    expect(rejected.stdout).not.toContain("open-url");
    expect(rejected.stderr).toContain("PKCE");
    expect(
      (
        await invoke(["desktop", "login"], {
          service: "demo-auth",
          credential: "bot",
          secret: token,
        })
      ).code,
    ).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "mcp-cli/credentials/demo-auth--bot.json"), "utf8"))
        .accessToken,
    ).toBe(token);
    expect((await invoke(["logout", "demo-auth", "--web"])).code).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "mcp-cli/credentials/demo-auth--bot.json"), "utf8"))
        .accessToken,
    ).toBe(token);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
