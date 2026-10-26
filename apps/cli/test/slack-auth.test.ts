import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("CLI and desktop share Slack settings and token storage without silent browser fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slack-surfaces-"));
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
        SLACK_MCP_TOKEN: "",
        SLACK_MCP_BOT_TOKEN: "",
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
    const configuration = {
      mcp: { method: "token" },
      web: {
        method: "pkce",
        clientId: "123.456",
        appId: "ATEST",
        teamId: "TTEST",
        redirectUri: "http://localhost:8765/callback",
        scopes: ["channels:read"],
        pkceEnabled: false,
      },
    };
    expect((await invoke(["auth", "configure", "slack"], configuration)).code).toBe(0);
    const cli = await invoke(["auth", "status", "slack", "--json"]);
    expect(cli.code).toBe(0);
    const desktop = await invoke(["desktop", "services"]);
    expect(desktop.code).toBe(0);
    const services = JSON.parse(desktop.stdout).result;
    expect(services.find((item: { name: string }) => item.name === "slack").authentication).toEqual(
      JSON.parse(cli.stdout),
    );
    const rejected = await invoke(["desktop", "login"], {
      service: "slack",
      target: "web",
      method: "browser",
    });
    expect(rejected.code).toBe(2);
    expect(rejected.stdout).not.toContain("open-url");
    expect(rejected.stderr).toContain("PKCE");
    expect(
      (await invoke(["desktop", "login"], { service: "slack", credential: "xoxb", secret: token }))
        .code,
    ).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "mcp-cli/credentials/slack--xoxb.json"), "utf8"))
        .accessToken,
    ).toBe(token);
    expect((await invoke(["logout", "slack", "--web"])).code).toBe(0);
    expect(
      JSON.parse(await readFile(join(directory, "mcp-cli/credentials/slack--xoxb.json"), "utf8"))
        .accessToken,
    ).toBe(token);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
