import { expect, test } from "bun:test";
import { definePlugin, type TokenStore, type Tokens } from "@mcp-cli/core";
import { extensionCacheScope } from "../src/cache-scope";

const fixture = () => {
  let value: Tokens | undefined = { accessToken: "first" };
  const store: TokenStore = {
    read: async () => value,
    write: async (_, tokens) => {
      value = tokens;
    },
    delete: async () => {
      value = undefined;
    },
    withLock: async (_, action) => action(),
  };
  const plugin = definePlugin({
    name: "fixture",
    summary: "fixture",
    auth: { type: "oauth" },
    connection: () => ({ type: "http", url: "https://fixture.test/mcp" }),
  });
  return { store, plugin };
};

test("OAuth cache partition survives token rotation and changes on a fresh login", async () => {
  const { store, plugin } = fixture();
  const first = await extensionCacheScope(plugin, {}, store);
  const stored = await store.read("fixture");
  expect(stored?.cacheIdentity).toBeString();
  await store.write("fixture", { ...stored, accessToken: "rotated" });
  expect(await extensionCacheScope(plugin, {}, store)).toBe(first);
  await store.write("fixture", { accessToken: "new-login" });
  expect(await extensionCacheScope(plugin, {}, store)).not.toBe(first);
});

test("explicit authorization and server identity partition workflow caches without persisting secrets", async () => {
  const { store, plugin } = fixture();
  const explicit = {
    ...plugin,
    connection: (env: Record<string, string | undefined>) => ({
      type: "http" as const,
      url: env.URL ?? "https://fixture.test/mcp",
      authorize: async () => ({ Authorization: `Bearer ${env.TOKEN}` }),
    }),
  };
  const first = await extensionCacheScope(explicit, { TOKEN: "alpha" }, store);
  expect(first).not.toContain("alpha");
  expect(await extensionCacheScope(explicit, { TOKEN: "alpha" }, store)).toBe(first);
  expect(await extensionCacheScope(explicit, { TOKEN: "beta" }, store)).not.toBe(first);
  expect(
    await extensionCacheScope(explicit, { TOKEN: "alpha", URL: "https://other.test/mcp" }, store),
  ).not.toBe(first);
  expect((await store.read("fixture"))?.cacheIdentity).toBeUndefined();
});
