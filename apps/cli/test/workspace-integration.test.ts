import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon } from "../src/daemon/server";
import { daemonRequest } from "../src/daemon/client";
import type { WorkspaceRegistry } from "@mcp-cli/core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
test("CLI, desktop and daemon share workspace credentials without changing the default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-integration-"));
  const pluginDir = join(directory, "plugin");
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      seen.push(request.headers.get("authorization") ?? "");
      return Response.json({ ok: true, user_id: "U0123456789" });
    },
  });
  await mkdir(pluginDir);
  await Bun.write(
    join(pluginDir, "package.json"),
    JSON.stringify({
      name: "slack-workspace-test",
      type: "module",
      exports: "./index.ts",
      "mcp-cli": { plugin: true, service: "slack-workspace-test" },
    }),
  );
  await Bun.write(
    join(pluginDir, "index.ts"),
    `import slack from ${JSON.stringify(join(root, "plugins/slack/src/index.ts"))}; import {updateWorkspace} from ${JSON.stringify(join(root, "apps/cli/src/workspaces.ts"))}; export default {...slack,name:"slack-workspace-test",commands:{},groups:{},quickstart:[],extensions:{...slack.extensions,commands:[...slack.extensions.commands,{path:["workspace-probe"],kind:"workflow",summary:"Probe inheritance",inputSchema:{type:"object"},run:async(_,context)=>{await updateWorkspace({...slack,name:"slack-workspace-test"},{type:"default",service:"slack-workspace-test",workspace:"default"});const a=await context.runCommand(["auth","check"]);const b=await context.runCommand(["auth","check","-w","default"]);return {result:{content:[{type:"text",text:JSON.stringify([a.exitCode,b.exitCode])}]}}}}]},connection:async(env)=>{const config=await slack.connection(env);return {...config,url:"http://127.0.0.1:1/mcp",webApi:{...config.webApi,url:${JSON.stringify(String(server.url))}}}}};`,
  );
  await mkdir(join(pluginDir, "src"));
  await Bun.write(
    join(pluginDir, "src/generated.ts"),
    'export const manifest = {version:2, service:"slack-workspace-test", tools:[]};',
  );
  const config = join(directory, "config.json");
  await Bun.write(config, JSON.stringify({ plugins: [pluginDir] }));
  const env = {
    ...process.env,
    MCP_CLI_CONFIG: config,
    XDG_CONFIG_HOME: directory,
    XDG_STATE_HOME: directory,
    MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
    MCP_CLI_DAEMON: "0",
    SLACK_MCP_TOKEN: "xoxp-legacy-env",
    SLACK_MCP_BOT_TOKEN: "",
  };
  const run = async (args: string[], input?: unknown) => {
    const child = Bun.spawn([process.execPath, "apps/cli/src/main.ts", ...args], {
      cwd: root,
      env,
      stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    return stdout;
  };
  const daemon = await startDaemon(join(directory, "daemon"));
  try {
    const added: WorkspaceRegistry = JSON.parse(
      await run(["workspaces", "add", "slack-workspace-test", "company", "--json"]),
    );
    const id = added.workspaces.find((item) => item.name === "company")?.id;
    expect(id).toBeString();
    const saved = await run(["desktop", "login"], {
      service: "slack-workspace-test",
      workspace: id,
      secret: "xoxp-company",
    });
    expect(saved).not.toContain("xoxp-company");
    // Login resets the daemon, so subsequent calls start with an empty pool.
    await run(["slack-workspace-test", "-w", "company", "auth", "check"]);
    await run(["--workspace", "company", "slack-workspace-test", "auth", "check"]);
    await run(["slack-workspace-test", "auth", "check"]);
    expect(seen).toEqual(["Bearer xoxp-company", "Bearer xoxp-company", "Bearer xoxp-legacy-env"]);
    const context = {
      service: "slack-workspace-test",
      cwd: directory,
      env,
      name: "web.auth.test",
      input: {},
    };
    await daemonRequest("callTool", { ...context, workspace: id }, join(directory, "daemon"));
    await daemonRequest(
      "callTool",
      { ...context, workspace: "company" },
      join(directory, "daemon"),
    );
    expect(daemon.status()).toHaveLength(1);
    await daemonRequest("callTool", context, join(directory, "daemon"));
    expect(daemon.status()).toHaveLength(2);
    expect(seen.slice(3)).toEqual([
      "Bearer xoxp-company",
      "Bearer xoxp-company",
      "Bearer xoxp-legacy-env",
    ]);
    const listed = await run(["desktop", "services"]);
    expect(listed).toContain('"name":"company"');
    expect(listed).not.toContain("xoxp-company");
    await run(["workspaces", "default", "slack-workspace-test", "company"]);
    await run(["slack-workspace-test", "auth", "check"]);
    expect(seen.at(-1)).toBe("Bearer xoxp-company");
    await run(["slack-workspace-test", "workspace-probe", "-w", "company"]);
    expect(seen.slice(-2)).toEqual(["Bearer xoxp-company", "Bearer xoxp-legacy-env"]);
    await run(["desktop", "logout"], { service: "slack-workspace-test", workspace: id });
    await run(["slack-workspace-test", "auth", "check", "-w", "default"]);
    expect(seen.at(-1)).toBe("Bearer xoxp-legacy-env");
  } finally {
    await daemon.stop();
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
