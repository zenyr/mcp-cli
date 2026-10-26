import { expect, test } from "bun:test";
import { AuthRequiredError, type ServicePlugin, type TokenStore, type Tokens } from "@mcp-cli/core";
import { resolveConnection } from "../src/auth";
import { pluginStore } from "../src/plugin-credentials";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
      outdir: directory,
      naming: "plugin.mjs",
      target: "bun",
    });
    expect(built.success).toBe(true);
    const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const script = `const host = await import(${JSON.stringify(main)}); const plugin = await import(${JSON.stringify(join(directory, "plugin.mjs"))}); console.log(JSON.stringify([host.exitCodeFor(new plugin.UsageError("bad")), host.exitCodeFor(new plugin.RepeatedCallError("again"))]));`;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual([2, 3]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
