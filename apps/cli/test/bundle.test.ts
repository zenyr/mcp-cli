import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
test("installed binary activates independent plugin packages without Bun or the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-cli-bundle-"));
  const name = process.platform === "win32" ? "mcp-cli.exe" : "mcp-cli";
  const built = join(directory, name);
  const installed = join(directory, "installed", name);
  const build = Bun.spawn([process.execPath, join(root, "apps/cli/scripts/build.ts"), built], {
    cwd: root,
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const errors = await new Response(build.stderr).text();
    expect(await build.exited, errors).toBe(0);
    await mkdir(join(directory, "installed"));
    await rename(built, installed);
    await cp(`${built}.plugins`, `${installed}.plugins`, { recursive: true });
    const env = {
      ...process.env,
      HOME: directory,
      PATH: join(directory, "installed"),
      MCP_CLI_CONFIG: "",
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_CACHE_HOME: join(directory, "cache"),
      XDG_STATE_HOME: join(directory, "state"),
      MCP_CLI_DAEMON: "0",
      MCP_CLI_DAEMON_DIR: join(directory, "daemon"),
    };
    const run = async (...args: string[]) => {
      const child = Bun.spawn([installed, ...args], {
        cwd: directory,
        env,
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
    const empty = JSON.parse(await run("plugins", "list", "--json"));
    expect(empty.sources).toEqual([]);
    expect(empty.plugins).toEqual([]);
    expect(empty.recommendations.map((item: { id: string }) => item.id)).toEqual(["builtin"]);
    expect(await run("plugins", "catalog", "recommended")).toContain("builtin");
    await run("plugins", "catalog", "add", "builtin");
    const plugins = await run("plugins");
    for (const name of ["demo", "notion", "linear", "slack", "fish-audio"])
      expect(plugins).toContain(name);
    expect(plugins).toContain("available");
    expect(plugins).not.toContain(root);
    await run("plugins", "install", "builtin", "builtin.demo", "--allow-local-code");
    await run("plugins", "install", "builtin", "builtin.notion");
    await run("plugins", "enable", "notion", "--allow-local-code");
    expect(await run("demo", "message", "echo", "--text", "설치 없이 실행")).toBe(
      "설치 없이 실행\n",
    );
    if (process.platform !== "win32") {
      const direct = Bun.spawn(
        [
          join(directory, ".local/bin/demo"),
          "message",
          "echo",
          "--text",
          "한 인수 $HOME ; literal",
        ],
        {
          env,
          cwd: directory,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await direct.exited, await new Response(direct.stderr).text()).toBe(0);
      expect(await new Response(direct.stdout).text()).toBe("한 인수 $HOME ; literal\n");
    }
    expect(await run("notion", "--help")).toContain("page");
    await run("generate", "demo");
    expect(await run("demo", "message", "echo", "--text", "캐시 정의 사용")).toBe(
      "캐시 정의 사용\n",
    );
    const cache = (await readdir(join(directory, "cache/mcp-cli"))).find((name) =>
      name.startsWith("demo-"),
    );
    expect(cache).toBeDefined();
    expect(
      await Bun.file(join(directory, "cache/mcp-cli", cache ?? "", "generated.ts")).exists(),
    ).toBe(true);
    expect(await run("plugins")).toContain("enabled");
    const daemon = Bun.spawn([installed, "daemon", "start"], {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const ready = await daemon.stdout.getReader().read();
      expect(new TextDecoder().decode(ready.value)).toContain('"event":"ready"');
      env.MCP_CLI_DAEMON = "";
      expect(await run("demo", "message", "echo", "--text", "백그라운드 연결")).toBe(
        "백그라운드 연결\n",
      );
      env.MCP_CLI_DAEMON = "0";
      await run("daemon", "stop");
      expect(await daemon.exited).toBe(0);
      env.MCP_CLI_DAEMON = "";
      expect(await run("demo", "message", "echo", "--text", "대몬 없이 실행")).toBe(
        "대몬 없이 실행\n",
      );
      await run("plugins", "remove", "demo");
      await run("plugins", "remove", "notion");
      await run("plugins", "catalog", "remove", "builtin");
      const removed = JSON.parse(await run("plugins", "list", "--json"));
      expect(removed.sources).toEqual([]);
      expect(removed.plugins).toEqual([]);
      expect(removed.recommendations).toHaveLength(1);
    } finally {
      if (daemon.exitCode === null) daemon.kill();
      await daemon.exited;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
