import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import git from "isomorphic-git";
import { Effect, Fiber } from "effect";
import { discover, findPlugin, loadPlugin } from "../src/discovery";
import { cacheFiles, loadManifest } from "../src/plugins";
import { commandText } from "../src/marketplace/commands";
import { scaffold } from "../src/marketplace/scaffold";
import { desktopService } from "../src/desktop-services";
import { defaultStore } from "../src/auth";
import { gunzipSync } from "node:zlib";
import { runMarketplace } from "../src/marketplace/entry";
import { runCli } from "./host";
import { manage, type ManagerContext } from "../src/marketplace/manager";
import { marketView } from "../src/marketplace/catalog";
import { packDirectory, safePath, unpack } from "../src/marketplace/archive";
import {
  digest,
  pluginKey,
  marketRoot,
  readState,
  writeState,
  transaction,
  type MarketplaceError,
} from "../src/marketplace/storage";
import {
  Catalog,
  decode,
  selectArtifact,
  type CatalogPlugin,
  type PackageManifest,
} from "../src/marketplace/schema";

const market = <A>(operation: Effect.Effect<A, MarketplaceError>) =>
  Effect.runPromise(runMarketplace(operation));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mcp-market-"));
  roots.push(root);
  const context: ManagerContext = {
    home: root,
    env: {
      HOME: root,
      PATH: "",
      SHELL: "/bin/zsh",
      MCP_CLI_CONFIG: join(root, "config/config.json"),
    },
    reset: async () => {},
  };
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/config.json"), "{}");
  const repository = join(root, "catalog");
  const source = join(root, "source");
  await mkdir(repository);
  await mkdir(source);
  await git.init({ fs, dir: repository, defaultBranch: "main" });
  const manifest: PackageManifest = {
    schemaVersion: 1,
    id: "test.hello",
    service: "hello",
    name: "Hello",
    description: "test plugin",
    version: "1.0.0",
    permissions: { localCode: true, network: [], filesystem: [] },
    implementation: { type: "module", entry: "plugin.mjs" },
  };
  const sideEffect = join(root, "executed");
  await writeFile(join(source, "plugin.json"), JSON.stringify(manifest));
  await writeFile(
    join(source, "manifest.json"),
    JSON.stringify({
      version: 2,
      service: "hello",
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    }),
  );
  await writeFile(
    join(source, "plugin.mjs"),
    `import {writeFile} from 'node:fs/promises'; await writeFile(${JSON.stringify(sideEffect)}, 'yes'); export default {name:'hello',summary:'Hello',connection:()=>({type:'http',url:'https://example.com/mcp'})};`,
  );
  const bytes = await packDirectory(source);
  const archive = join(root, "hello.tar.gz");
  await writeFile(archive, bytes);
  const plugin: CatalogPlugin = {
    id: manifest.id,
    service: manifest.service,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    permissions: manifest.permissions,
    artifacts: [
      { url: pathToFileURL(archive).href, sha256: digest(bytes), platform: "any", arch: "any" },
    ],
  };
  const catalog: Catalog = { schemaVersion: 1, name: "Test", plugins: [plugin] };
  const commit = async (value: Catalog) => {
    await writeFile(join(repository, "marketplace.json"), JSON.stringify(value));
    await git.add({ fs, dir: repository, filepath: "marketplace.json" });
    return git.commit({
      fs,
      dir: repository,
      message: "catalog",
      author: { name: "test", email: "test@example.com" },
    });
  };
  const revision = await commit(catalog);
  const run = (action: unknown) => market(manage(context, action));
  await run({ type: "source.add", url: repository });
  const sourceId = (await readState(context)).sources[0]?.id ?? "";
  const key = pluginKey(sourceId, plugin.id);
  return {
    root,
    context,
    repository,
    source,
    manifest,
    plugin,
    catalog,
    commit,
    revision,
    sideEffect,
    run,
    sourceId,
    key,
  };
};

test("catalog and installation never execute plugin code; only enabled discovery imports it", async () => {
  const f = await fixture();
  expect((await readState(f.context)).sources[0]?.commit).toBe(f.revision);
  await f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id });
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
  const discoveryContext = { ...f.context, writable: async () => false, nodeModules: [] };
  expect((await discover(discoveryContext)).plugins).toHaveLength(0);
  await expect(f.run({ type: "plugin.enable", key: f.key, enabled: true })).rejects.toThrow(
    "explicit approval",
  );
  await f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true });
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
  const registry = await discover(discoveryContext);
  expect((await loadPlugin(findPlugin(registry, "hello"), discoveryContext)).name).toBe("hello");
  expect(await Bun.file(f.sideEffect).text()).toBe("yes");
  expect(await Bun.file(join(f.root, ".local/bin/hello")).exists()).toBe(true);
  await f.run({ type: "plugin.enable", key: f.key, enabled: false });
  expect((await discover(discoveryContext)).plugins).toHaveLength(0);
  expect(await Bun.file(join(f.root, ".local/bin/hello")).exists()).toBe(false);
});

test("installation with consent activates and creates commands without importing code", async () => {
  const f = await fixture();
  let resets = 0;
  const result = await market(
    manage(
      {
        ...f.context,
        reset: async () => {
          resets += 1;
        },
      },
      {
        type: "plugin.install",
        sourceId: f.sourceId,
        pluginId: f.plugin.id,
        enable: true,
        allowLocalCode: true,
      },
    ),
  );
  expect(result.message).toBe("설치하고 활성화했습니다.");
  expect((await readState(f.context)).installed[0]?.enabled).toBe(true);
  expect(await Bun.file(join(f.root, ".local/bin/hello")).exists()).toBe(true);
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
  expect(resets).toBe(1);
  const context = { ...f.context, writable: async () => false, nodeModules: [] };
  expect(findPlugin(await discover(context), "hello").installed?.enabled).toBe(true);
});

test("installation activation requires consent and preserves state when command creation fails", async () => {
  const f = await fixture();
  const install = {
    type: "plugin.install",
    sourceId: f.sourceId,
    pluginId: f.plugin.id,
    enable: true,
  };
  await expect(f.run(install)).rejects.toThrow("explicit approval");
  expect((await readState(f.context)).installed).toHaveLength(0);
  const command = join(f.root, ".local/bin/hello");
  await mkdir(join(command, ".."), { recursive: true });
  await writeFile(command, "user command");
  await expect(f.run({ ...install, allowLocalCode: true })).rejects.toThrow("not owned");
  expect((await readState(f.context)).installed).toHaveLength(0);
  expect(await Bun.file(command).text()).toBe("user command");
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
  expect(await Bun.file(join(marketRoot(f.context), "operation.lock")).exists()).toBe(false);
});

test("an update with consent remains enabled without a separate activation", async () => {
  const f = await fixture();
  const install = {
    type: "plugin.install",
    sourceId: f.sourceId,
    pluginId: f.plugin.id,
    enable: true,
    allowLocalCode: true,
  };
  await f.run(install);
  await writeFile(
    join(f.source, "plugin.json"),
    JSON.stringify({ ...f.manifest, version: "2.0.0" }),
  );
  const bytes = await packDirectory(f.source);
  const archive = join(f.root, "hello-v2.tar.gz");
  await writeFile(archive, bytes);
  await f.commit({
    ...f.catalog,
    plugins: [
      {
        ...f.plugin,
        version: "2.0.0",
        artifacts: [
          { ...f.plugin.artifacts[0], url: pathToFileURL(archive).href, sha256: digest(bytes) },
        ],
      },
    ],
  });
  await f.run({ type: "source.refresh", id: f.sourceId });
  await f.run(install);
  const installed = (await readState(f.context)).installed[0];
  expect(installed?.enabled).toBe(true);
  expect(installed?.manifest.version).toBe("2.0.0");
  expect(installed?.artifact.sha256).toBe(digest(bytes));
  expect(await Bun.file(join(f.root, ".local/bin/hello")).exists()).toBe(true);
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
});

test("hash mismatches and identity changes leave installation state intact and release the lock", async () => {
  const f = await fixture();
  const changed: Catalog = {
    ...f.catalog,
    plugins: [{ ...f.plugin, artifacts: [{ ...f.plugin.artifacts[0], sha256: "0".repeat(64) }] }],
  };
  await f.commit(changed);
  await f.run({ type: "source.refresh", id: f.sourceId });
  await expect(
    f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id }),
  ).rejects.toThrow("SHA-256");
  expect((await readState(f.context)).installed).toHaveLength(0);
  await f.commit({
    ...f.catalog,
    plugins: [{ ...f.plugin, permissions: { ...f.plugin.permissions, localCode: false } }],
  });
  await f.run({ type: "source.refresh", id: f.sourceId });
  await expect(
    f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id }),
  ).rejects.toThrow("differ");
  expect(await Bun.file(join(marketRoot(f.context), "operation.lock")).exists()).toBe(false);
});

test("catalog refresh revokes only the matching digest and never runs new code", async () => {
  const f = await fixture();
  await f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id });
  await f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true });
  await f.commit({
    ...f.catalog,
    revoked: [
      { id: f.plugin.id, sha256: f.plugin.artifacts[0].sha256, reason: "Removed test build" },
    ],
  });
  await f.run({ type: "source.refresh", id: f.sourceId });
  expect((await readState(f.context)).installed[0]?.enabled).toBe(false);
  expect(await Bun.file(join(f.root, ".local/bin/hello")).exists()).toBe(false);
  await expect(
    f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true }),
  ).rejects.toThrow("revoked");
  expect(await Bun.file(f.sideEffect).exists()).toBe(false);
});

test("existing commands are never overwritten and edited owned commands survive removal", async () => {
  const f = await fixture();
  await f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id });
  const command = join(f.root, ".local/bin/hello");
  await mkdir(join(command, ".."), { recursive: true });
  await writeFile(command, "user command");
  await expect(
    f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true }),
  ).rejects.toThrow("not owned");
  expect((await readState(f.context)).installed[0]?.enabled).toBe(false);
  await rm(command);
  await f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true });
  await writeFile(command, "changed by user");
  await f.run({ type: "plugin.remove", key: f.key });
  expect(await readFile(command, "utf8")).toBe("changed by user");
});

test("command wrappers preserve argument forwarding and quote executable paths", () => {
  expect(commandText(["/a b/o'k", "/source/main.ts"], "hello", "linux")).toContain(
    "'/a b/o'\\''k'",
  );
  expect(commandText(["C:\\Program Files\\app.exe"], "hello", "win32")).toContain(
    '"C:\\Program Files\\app.exe" "hello" %*',
  );
  expect(() => commandText(['bad"path'], "hello", "win32")).toThrow("Invalid Windows");
});

test("archive paths and platform metadata fail closed", async () => {
  for (const path of ["../bad", "/tmp/bad", "a/../../b", "a\\b", "C:/file", "a//b", "a\nname"])
    expect(() => safePath(path)).toThrow("Unsafe");
  const artifact = {
    url: "https://example.com/plugin.tgz",
    sha256: "0".repeat(64),
    platform: "linux",
    arch: "x64",
  } as const;
  expect(() => selectArtifact([artifact], "darwin", "arm64")).toThrow("does not support");
  expect(() => selectArtifact([artifact, artifact], "linux", "x64")).toThrow("Ambiguous");
  expect(() =>
    decode(
      Catalog,
      { schemaVersion: 1, name: "bad", plugins: [], install: "sh bad.sh" },
      "catalog",
    ),
  ).toThrow("Invalid catalog");
  const bytes = await new Bun.Archive({ file: "hello" }).bytes();
  bytes[156] = 50;
  bytes.fill(32, 148, 156);
  const checksum = bytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  bytes.set(new TextEncoder().encode(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);
  expect(() => unpack(bytes)).toThrow("Only regular files");
});

test("operation lock releases after typed failure and denies concurrent mutations", async () => {
  const f = await fixture();
  let release = () => {};
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fiber = Effect.runFork(
    transaction(f.context, async () => {
      started();
      await hold;
    }),
  );
  await ready;
  await expect(f.run({ type: "source.remove", id: "missing" })).rejects.toThrow(
    "Another plugin operation",
  );
  release();
  await Effect.runPromise(Fiber.join(fiber));
  await expect(f.run({ type: "unknown" })).rejects.toThrow("Invalid plugin action");
  expect(await Bun.file(join(marketRoot(f.context), "operation.lock")).exists()).toBe(false);
});

test("starter links and executes through the same service command as an installed plugin", async () => {
  const f = await fixture();
  const directory = join(f.root, "starter");
  await scaffold("starter", directory);
  await f.run({ type: "plugin.link", directory });
  const key = (await readState(f.context)).installed[0]?.key;
  await f.run({ type: "plugin.enable", key, enabled: true, allowLocalCode: true });
  const command = join(
    f.root,
    ".local/bin",
    process.platform === "win32" ? "starter.cmd" : "starter",
  );
  // The generated command file and its shell launcher are the subject, so this stays a real process.
  const child = Bun.spawn(
    process.platform === "win32"
      ? ["cmd.exe", "/d", "/c", command, "message", "echo", "--text", "hello"]
      : [command, "message", "echo", "--text", "hello"],
    {
      env: { ...process.env, ...f.context.env, MCP_CLI_DAEMON: "0" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout).toBe("hello\n");
});

test("plugins command resolves relative folders against the host directory", async () => {
  const f = await fixture();
  const options = { env: f.context.env, cwd: f.root };
  const created = await runCli(["plugins", "init", "starter", "starter"], options);
  expect(created).toEqual({
    stdout: `Created ${join(f.root, "starter")}. Link the folder from the app to test it.\n`,
    stderr: "",
    code: 0,
  });
  expect((await runCli(["plugins", "link", "starter"], options)).code).toBe(0);
  const listed = await runCli(["plugins", "list", "--json"], options);
  const view: unknown = JSON.parse(listed.stdout);
  expect(view).toMatchObject({
    plugins: expect.arrayContaining([
      expect.objectContaining({ service: "starter", enabled: false }),
    ]),
  });
  expect(await runCli(["plugins", "enable", "missing"], options)).toEqual({
    stdout: "",
    stderr: "Installed plugin not found.\n",
    code: 2,
  });
  expect((await runCli(["plugins", "unknown"], options)).code).toBe(2);
});

test("link validation rejects undeclared code execution", async () => {
  const f = await fixture();
  await writeFile(
    join(f.source, "plugin.json"),
    JSON.stringify({
      ...f.manifest,
      permissions: { localCode: false, network: [], filesystem: [] },
    }),
  );
  await expect(f.run({ type: "plugin.link", directory: f.source })).rejects.toThrow("localCode");
  expect((await readState(f.context)).installed).toHaveLength(0);
});

test("managed runtime downloads are hashed and prepared by the host for development too", async () => {
  const f = await fixture();
  const runtimeFile = join(f.root, "runtime.tar.gz");
  const bytes = await new Bun.Archive(
    { "bin/runtime": "runtime fixture" },
    { compress: "gzip" },
  ).bytes();
  await writeFile(runtimeFile, bytes);
  const manifest: PackageManifest = {
    ...f.manifest,
    implementation: {
      type: "mcp",
      server: {
        type: "stdio",
        entry: "plugin.mjs",
        runtime: {
          kind: "managed",
          id: "test.runtime",
          executable: "bin/runtime",
          artifacts: [
            {
              url: pathToFileURL(runtimeFile).href,
              sha256: digest(bytes),
              platform: "any",
              arch: "any",
            },
          ],
        },
      },
    },
  };
  await writeFile(join(f.source, "plugin.json"), JSON.stringify(manifest));
  await f.run({ type: "plugin.link", directory: f.source });
  const installed = (await readState(f.context)).installed[0];
  expect(installed?.runtime?.sha256).toBe(digest(bytes));
  await f.run({ type: "plugin.enable", key: installed?.key, enabled: true, allowLocalCode: true });
  const context = { ...f.context, writable: async () => false, nodeModules: [] };
  const registry = await discover(context);
  const plugin = await loadPlugin(findPlugin(registry, "hello"), context);
  const connection = await plugin.connection({});
  expect(connection.type).toBe("stdio");
  if (connection.type !== "stdio") throw new Error("Expected managed runtime");
  expect(connection.command).toBe(
    join(marketRoot(f.context), "objects", digest(bytes), "bin/runtime"),
  );
  expect(await Bun.file(connection.command).text()).toBe("runtime fixture");
  expect(connection.isolatedEnv).toBe(true);
});

test("PATH setup is idempotent and preserves existing shell configuration", async () => {
  if (process.platform === "win32") return;
  const f = await fixture();
  await writeFile(join(f.root, ".zshrc"), "# user configuration\n");
  await f.run({ type: "commands.install" });
  await f.run({ type: "commands.install" });
  const text = await readFile(join(f.root, ".zshrc"), "utf8");
  expect(text.startsWith("# user configuration\n")).toBe(true);
  expect(text.match(/export PATH=/g)).toHaveLength(1);
});

test("a broken plugin produces its own service error instead of failing the inventory", async () => {
  const f = await fixture();
  await writeFile(join(f.source, "plugin.mjs"), "throw new Error('broken plugin');");
  await f.run({ type: "plugin.link", directory: f.source });
  const key = (await readState(f.context)).installed[0]?.key;
  await f.run({ type: "plugin.enable", key, enabled: true, allowLocalCode: true });
  const registry = await discover({ ...f.context, writable: async () => false, nodeModules: [] });
  const result = await desktopService(
    findPlugin(registry, "hello"),
    registry,
    defaultStore(f.context.env),
  );
  expect(result.name).toBe("hello");
  expect(result).toHaveProperty("error", "broken plugin");
});

test("package output normalizes tar timestamps for reproducible hashes", async () => {
  const f = await fixture();
  const first = await packDirectory(f.source);
  const second = await packDirectory(f.source);
  expect(digest(first)).toBe(digest(second));
  const tar = gunzipSync(first);
  expect(new TextDecoder().decode(tar.subarray(136, 148))).toBe("00000000000\0");
  expect(unpack(first).has("plugin.json")).toBe(true);
});

test("viewing recommendations does not register a catalog or create state", async () => {
  const f = await fixture();
  const context = {
    ...f.context,
    env: { ...f.context.env, MCP_CLI_CONFIG: join(f.root, "fresh/config.json") },
  };
  const stateFile = join(marketRoot(context), "state.json");
  const view = await market(marketView(context));
  expect(view.sources).toEqual([]);
  expect(view.plugins).toEqual([]);
  expect(await Bun.file(stateFile).exists()).toBe(false);
});

test("legacy builtin installations remain enabled without forcing their catalog registration", async () => {
  const f = await fixture();
  await f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id });
  await f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true });
  const installed = (await readState(f.context)).installed[0];
  if (!installed) throw new Error("Missing installed fixture");
  const state = {
    ...(await readState(f.context)),
    sources: [],
    installed: [{ ...installed, sourceId: "builtin" }],
  };
  await writeState(f.context, state);
  const view = await market(marketView(f.context));
  expect(view.sources).toEqual([]);
  expect(view.plugins).toHaveLength(1);
  expect(view.plugins[0]?.enabled).toBe(true);
  expect(await readState(f.context)).toEqual(state);
  const registry = await discover({ ...f.context, nodeModules: [], writable: async () => false });
  expect(findPlugin(registry, "hello").installed?.enabled).toBe(true);
});

test("session descriptors keep bootstrap catalogs despite generated caches; static descriptors keep overrides", async () => {
  const f = await fixture();
  const manifest = {
    ...f.manifest,
    permissions: { localCode: false, network: ["example.com"], filesystem: [] },
    implementation: {
      type: "mcp",
      server: { type: "http", url: "https://example.com/mcp" },
      discovery: { tools: "session" },
    },
  };
  await writeFile(join(f.source, "plugin.json"), JSON.stringify(manifest));
  await f.run({ type: "plugin.link", directory: f.source });
  const key = (await readState(f.context)).installed[0]?.key;
  await f.run({ type: "plugin.enable", key, enabled: true });
  const context = { ...f.context, nodeModules: [], writable: async () => true };
  const registry = await discover(context);
  const found = findPlugin(registry, "hello");
  const loaded = await loadPlugin(found, context);
  expect(loaded.discovery).toEqual({ tools: "session" });
  expect(loaded.credentialNamespace).toBe(`plugin-${key}`);
  const cache = cacheFiles(registry, found);
  await mkdir(join(cache.module, ".."), { recursive: true });
  await writeFile(cache.module, 'export const manifest = {version:2,service:"hello",tools:[]};');
  expect((await loadManifest(registry, found)).tools.map(({ name }) => name)).toEqual(["echo"]);
  const installed = found.installed;
  if (!installed) throw new Error("Missing installed fixture");
  const staticFound = {
    ...found,
    installed: {
      ...installed,
      manifest: {
        ...installed.manifest,
        implementation: {
          type: "mcp" as const,
          server: { type: "http" as const, url: "https://example.com/mcp" },
        },
      },
    },
  };
  expect((await loadManifest(registry, staticFound)).tools).toEqual([]);
});

test("catalog, linked and scaffolded plugins cannot take a reserved name like workspaces", async () => {
  const f = await fixture();
  const plugin = { ...f.plugin, id: "test.workspaces", service: "workspaces" };
  await f.commit({ ...f.catalog, plugins: [plugin] });
  await f.run({ type: "source.refresh", id: f.sourceId });
  await expect(
    f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: plugin.id }),
  ).rejects.toThrow("Reserved command name: workspaces");
  await writeFile(
    join(f.source, "plugin.json"),
    JSON.stringify({ ...f.manifest, service: "workspaces" }),
  );
  await writeFile(
    join(f.source, "manifest.json"),
    JSON.stringify({ version: 2, service: "workspaces", tools: [] }),
  );
  await expect(f.run({ type: "plugin.link", directory: f.source })).rejects.toThrow(
    "Reserved command name: workspaces",
  );
  expect((await readState(f.context)).installed).toHaveLength(0);
  await expect(scaffold("workspaces", join(f.root, "starter"))).rejects.toThrow(
    "Reserved command name: workspaces",
  );
  expect(fs.existsSync(join(f.root, "starter"))).toBe(false);
  expect(await Bun.file(join(f.root, ".local/bin/workspaces")).exists()).toBe(false);
});

test("an installed plugin that already holds a reserved name is neither enabled nor discovered", async () => {
  const f = await fixture();
  await f.run({ type: "plugin.install", sourceId: f.sourceId, pluginId: f.plugin.id });
  const state = await readState(f.context);
  const rename = (enabled: boolean) =>
    state.installed.map((item) => ({
      ...item,
      enabled,
      metadata: { ...item.metadata, service: "workspaces" },
    }));
  await writeState(f.context, { ...state, installed: rename(false) });
  await expect(
    f.run({ type: "plugin.enable", key: f.key, enabled: true, allowLocalCode: true }),
  ).rejects.toThrow("Reserved command name: workspaces");
  await writeState(f.context, { ...state, installed: rename(true) });
  const context = { ...f.context, writable: async () => false, nodeModules: [] };
  expect((await discover(context)).plugins).toHaveLength(0);
  await f.run({ type: "plugin.remove", key: f.key });
  expect((await readState(f.context)).installed).toHaveLength(0);
});
