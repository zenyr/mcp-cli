import { expect, test } from "bun:test";
import {
  AuthRequiredError,
  isRecord,
  UsageError,
  type ServicePlugin,
  type TokenStore,
  type Tokens,
} from "@mcp-cli/core";
import { resolveConnection } from "../src/auth";
import { pluginStore } from "../src/plugin-credentials";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exitCodeFor } from "../src/main";

test("plugins sharing a service name cannot inherit another catalog's credentials or environment key", async () => {
  const values = new Map<string, Tokens>([["hello", { accessToken: "legacy" }]]);
  const store: TokenStore = {
    read: async (name) => values.get(name),
    write: async (name, value) => {
      values.set(name, value);
    },
    delete: async (name) => {
      values.delete(name);
    },
    withLock: async (_name, run) => run(),
  };
  const base: ServicePlugin = {
    name: "hello",
    summary: "Hello",
    auth: { type: "apiKey", env: "SECRET" },
    connection: () => ({ type: "http", url: "https://example.com/mcp" }),
  };
  const first = { ...base, credentialNamespace: "plugin-first" };
  const second = { ...base, credentialNamespace: "plugin-second" };
  await expect(resolveConnection(first, { SECRET: "host-secret" }, store)).rejects.toBeInstanceOf(
    AuthRequiredError,
  );
  await pluginStore(first, store).write("hello", { accessToken: "first-token" });
  await expect(resolveConnection(second, {}, store)).rejects.toBeInstanceOf(AuthRequiredError);
  expect(await resolveConnection(first, {}, store)).toMatchObject({
    headers: { Authorization: "Bearer first-token" },
  });
  expect(await resolveConnection(base, {}, store)).toMatchObject({
    headers: { Authorization: "Bearer legacy" },
  });
});

test("independently bundled plugins preserve typed CLI errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-plugin-errors-"));
  try {
    const entry = join(directory, "entry.ts");
    const core = fileURLToPath(new URL("../../../packages/core/src/index.ts", import.meta.url));
    await writeFile(
      entry,
      `export { UsageError, RepeatedCallError } from ${JSON.stringify(core)};`,
    );
    const built = await Bun.build({
      entrypoints: [entry],
      // A separate output directory avoids the resolver listing cached while bundling the entry.
      outdir: join(directory, "out"),
      naming: "plugin.mjs",
      target: "bun",
    });
    expect(built.success).toBe(true);
    const plugin: unknown = await import(pathToFileURL(join(directory, "out", "plugin.mjs")).href);
    if (!isRecord(plugin)) throw new Error("expected a module namespace");
    const make = (name: string) => {
      const constructor = plugin[name];
      if (typeof constructor !== "function") throw new Error(`missing ${name}`);
      return Reflect.construct(constructor, ["bundled"]);
    };
    expect(plugin.UsageError).not.toBe(UsageError);
    expect([exitCodeFor(make("UsageError")), exitCodeFor(make("RepeatedCallError"))]).toEqual([
      2, 3,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
