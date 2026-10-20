import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConfigDirectory, readConfig } from "../src/config";
import { UsageError } from "@mcp-cli/core";

test("first launch creates the default config directory without replacing settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "mcp-cli-config-"));
  const directory = join(home, ".config", "mcp-cli");
  try {
    await ensureConfigDirectory({ HOME: home });
    expect((await stat(directory)).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const path = join(directory, "config.json");
    const contents = '{ "plugins": [] }\n';
    await Bun.write(path, contents);
    await ensureConfigDirectory({ HOME: home });
    expect(await Bun.file(path).text()).toBe(contents);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("config directory follows XDG and explicit paths without creating a config file", async () => {
  const home = await mkdtemp(join(tmpdir(), "mcp-cli-config-"));
  try {
    const xdg = join(home, "xdg");
    await ensureConfigDirectory({ HOME: home, XDG_CONFIG_HOME: xdg });
    expect((await stat(join(xdg, "mcp-cli"))).isDirectory()).toBe(true);
    const path = join(home, "custom", "config.json");
    await ensureConfigDirectory({ HOME: home, MCP_CLI_CONFIG: "~/custom/config.json" });
    expect((await stat(join(home, "custom"))).isDirectory()).toBe(true);
    expect(await Bun.file(path).exists()).toBe(false);
    await expect(readConfig(path, home, true)).rejects.toBeInstanceOf(UsageError);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
