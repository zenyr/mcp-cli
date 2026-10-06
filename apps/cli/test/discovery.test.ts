import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotGeneratedError, UsageError } from "@mcp-cli/core";
import { discover, findPlugin, loadPlugin } from "../src/discovery";
import { generate } from "../src/generate";
import { listPlugins } from "../src/list";
import type { DiscoveryContext } from "../src/paths";
import { configPath, defaultContext } from "../src/paths";
import { existingFiles, loadManifest, outputFiles } from "../src/plugins";

let root = "";
const write = async (path: string, value: unknown): Promise<void> => {
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, typeof value === "string" ? value : JSON.stringify(value));
};
const pluginSource = (name: string): string =>
  `export default { name: ${JSON.stringify(name)}, summary: "s", connection: () => ({ type: "stdio", command: "x" }) };\n`;
const addPackage = async (
  dir: string,
  name: string,
  marker: unknown,
  service = "",
): Promise<void> => {
  await write(join(dir, "package.json"), {
    name,
    type: "module",
    ...(marker !== undefined && { "mcp-cli": marker }),
    exports: { ".": "./src/index.ts" },
  });
  if (service) await write(join(dir, "src", "index.ts"), pluginSource(service));
};
const context = (overrides: Partial<DiscoveryContext> = {}): DiscoveryContext => ({
  env: { XDG_CACHE_HOME: join(root, "cache") },
  home: join(root, "home"),
  workspaceRoot: join(root, "ws"),
  nodeModules: [join(root, "ws", "node_modules")],
  writable: async () => true,
  ...overrides,
});
const userConfig = (ctx: DiscoveryContext) => configPath(ctx);

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mcp-cli-discovery-")));
  await write(join(root, "ws", "package.json"), { name: "ws", workspaces: ["plugins/*"] });
  await addPackage(join(root, "ws", "plugins", "alpha"), "@ws/alpha", { plugin: true }, "alpha");
  await addPackage(join(root, "ws", "plugins", "plain"), "@ws/plain", undefined);
  await addPackage(
    join(root, "ws", "node_modules", "@ext", "beta"),
    "@ext/beta",
    { plugin: true },
    "beta",
  );
  await addPackage(join(root, "ws", "node_modules", "lodash"), "lodash", undefined);
  await addPackage(
    join(root, "ext", "gamma"),
    "gamma-plugin",
    { plugin: true, service: "gamma" },
    "gamma",
  );
  await addPackage(
    join(root, "ext", "dup"),
    "dup-plugin",
    { plugin: true, service: "alpha" },
    "alpha",
  );
  await addPackage(join(root, "ext", "reserved"), "reserved", { plugin: true, service: "plugins" });
  await addPackage(join(root, "ext", "liar"), "liar", { plugin: true, service: "delta" }, "other");
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("discovers workspace, node_modules and config plugins", async () => {
  const ctx = context();
  await write(userConfig(ctx), { plugins: ["~/../ext/gamma", "@ext/beta"] });
  const registry = await discover(ctx);
  const summary = registry.plugins.map(({ service, source, packageName }) => [
    service,
    source,
    packageName,
  ]);
  expect(summary).toEqual([
    ["alpha", "workspace", "@ws/alpha"],
    ["beta", "node_modules", "@ext/beta"],
    ["gamma", "config", "gamma-plugin"],
  ]);
  expect((await loadPlugin(findPlugin(registry, "beta"))).name).toBe("beta");
  expect(() => findPlugin(registry, "constructor")).toThrow(UsageError);
  await rm(userConfig(ctx));
});

test("duplicate services name both sources", async () => {
  const ctx = context();
  await write(userConfig(ctx), { plugins: [join(root, "ext", "dup")] });
  const error = await discover(ctx).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("Duplicate service alpha");
  expect(String(error)).toContain("@ws/alpha");
  expect(String(error)).toContain("dup-plugin");
  await rm(userConfig(ctx));
});

test("reserved service names and mismatched plugin names are rejected", async () => {
  const ctx = context();
  await write(userConfig(ctx), { plugins: [join(root, "ext", "reserved")] });
  await expect(discover(ctx)).rejects.toThrow("reserved mcp-cli command");
  await write(userConfig(ctx), { plugins: [join(root, "ext", "liar")] });
  const registry = await discover(ctx);
  await expect(loadPlugin(findPlugin(registry, "delta"))).rejects.toThrow("exports plugin other");
  await rm(userConfig(ctx));
});

test("invalid config files are usage errors that name the file", async () => {
  const ctx = context();
  const path = userConfig(ctx);
  for (const value of [
    "{not json",
    [],
    { plugins: "x" },
    { plugins: [1] },
    { plugins: ["./relative"] },
    { extra: true },
    { plugins: ["missing-package"] },
  ]) {
    await write(path, value);
    const error = await discover(ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UsageError);
    expect(String(error)).toContain(path);
  }
  await rm(path);
  const explicit = join(root, "missing.json");
  const missing = context({ env: { MCP_CLI_CONFIG: explicit } });
  await expect(discover(missing)).rejects.toThrow(explicit);
});

test("generated files fall back to the cache when the package is not writable", async () => {
  const readOnly = context({ writable: async () => false });
  const registry = await discover(readOnly);
  const alpha = findPlugin(registry, "alpha");
  const output = await outputFiles(registry, alpha);
  expect(output.module).toBe(join(root, "cache", "mcp-cli", "alpha", "generated.ts"));
  expect((await outputFiles(await discover(context()), alpha)).location).toBe("package");
  await expect(loadManifest(registry, alpha)).rejects.toThrow(NotGeneratedError);
  expect(await listPlugins(registry, [])).toContain("not generated");

  const snapshot = join(root, "snapshot.json");
  await write(snapshot, { tools: [{ name: "ping", inputSchema: { type: "object" } }] });
  await generate(["alpha", "--snapshot", snapshot], registry);
  expect((await existingFiles(registry, alpha))?.location).toBe("cache");
  expect((await loadManifest(registry, alpha)).tools.map((tool) => tool.name)).toEqual(["ping"]);
  await generate(["alpha", "--snapshot", snapshot, "--check"], registry);
  expect(await listPlugins(registry, [])).toContain("generated (cache)");
});

test("plugins listing rejects arguments", async () => {
  const registry = await discover(context());
  await expect(listPlugins(registry, ["extra"])).rejects.toThrow(UsageError);
  expect(await listPlugins(registry, [])).toMatch(/^SERVICE\s+SOURCE\s+GENERATED/);
});

test("the default context finds the repository plugins", async () => {
  const registry = await discover(
    await defaultContext({ HOME: join(root, "home"), XDG_CACHE_HOME: join(root, "cache") }),
  );
  const services = registry.plugins.map((plugin) => plugin.service);
  expect(services).toEqual(expect.arrayContaining(["demo", "notion"]));
  expect(findPlugin(registry, "demo").source).toBe("workspace");
});
