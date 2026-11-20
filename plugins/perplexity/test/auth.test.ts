import { expect, test } from "bun:test";
import type { AuthSupportContext, SettingsStore, TokenStore, Tokens } from "@mcp-cli/core";
import { perplexityAuth } from "../src/auth-support";

const url = "https://api.perplexity.ai/mcp";
const connection = { type: "http" as const, url };
const oauth: Tokens = {
  accessToken: "oauth-token",
  refreshToken: "refresh",
  expiresAt: Date.now() + 3_600_000,
  client: { serverUrl: url, authorizationServer: "https://api.perplexity.ai", clientId: "c" },
};
const context = (tokens?: Tokens, env: Record<string, string> = {}): AuthSupportContext => {
  const slots = new Map<string, Tokens>(tokens ? [["pplx", tokens]] : []);
  const store: TokenStore = {
    read: async (name) => slots.get(name),
    write: async (name, value) => void slots.set(name, value),
    delete: async (name) => void slots.delete(name),
    withLock: (_name, fn) => fn(),
  };
  const settings: SettingsStore = {
    read: async () => undefined,
    write: async () => {},
    withLock: (_name, fn) => fn(),
  };
  return { env, store, settings };
};

test("a stored browser login authorizes with its OAuth access token", async () => {
  const resolved = await perplexityAuth.resolve(context(oauth), connection);
  if (resolved?.type !== "http" || !resolved.authorize) throw new Error("expected authorize");
  expect(await resolved.authorize({ refresh: false })).toEqual({
    Authorization: "Bearer oauth-token",
  });
});

test("an unrefreshable browser login asks for a browser login in the selected workspace", async () => {
  const expired = { ...oauth, refreshToken: undefined, expiresAt: 1 };
  const resolved = await perplexityAuth.resolve(
    { ...context(expired), workspace: "two" },
    connection,
  );
  if (resolved?.type !== "http" || !resolved.authorize) throw new Error("expected authorize");
  await expect(resolved.authorize({ refresh: false })).rejects.toThrow(
    "Run mcp-cli login pplx -w two --browser",
  );
});

test("API keys from the store or environment fall back to the host's key headers", async () => {
  expect(await perplexityAuth.resolve(context({ accessToken: "key" }), connection)).toBeUndefined();
  expect(await perplexityAuth.resolve(context(), connection)).toBeUndefined();
  const env = { PERPLEXITY_API_KEY: "env" };
  expect(await perplexityAuth.resolve(context(oauth, env), connection)).toBeUndefined();
});

test("status reports which credential the next call uses", async () => {
  const states = async (tokens?: Tokens, env?: Record<string, string>) =>
    (await perplexityAuth.status(context(tokens, env), false)).map((item) => item.state);
  expect(await states()).toEqual(["missing"]);
  expect(await states({ accessToken: "key" })).toEqual(["stored"]);
  expect(await states(oauth)).toEqual(["stored"]);
  expect(await states(undefined, { PERPLEXITY_API_KEY: "env" })).toEqual(["configured"]);
});

test("browser logout removes only a browser login", async () => {
  const key = context({ accessToken: "key" });
  await perplexityAuth.logout(key, { target: "oauth" });
  expect(await key.store.read("pplx")).toEqual({ accessToken: "key" });
  const browser = context(oauth);
  await perplexityAuth.logout(browser, { target: "oauth" });
  expect(await browser.store.read("pplx")).toBeUndefined();
});

test("a cancelled browser login forwards the signal and stores nothing", async () => {
  let hits = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      hits += 1;
      return new Response("not found", { status: 404 });
    },
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = context(undefined, { PERPLEXITY_MCP_URL: `${server.url.origin}/mcp` });
  await expect(
    perplexityAuth.login(cancelled, {
      signal: controller.signal,
      ui: {
        open: () => {
          throw new Error("Login reached the browser step");
        },
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  await server.stop(true);
  expect(hits).toBe(0);
  expect(await cancelled.store.read("pplx")).toBeUndefined();
});
