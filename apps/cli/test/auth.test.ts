import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileTokenStore } from "@mcp-cli/auth";
import {
  AuthRequiredError,
  definePlugin,
  UsageError,
  type AuthSpec,
  type Connection,
  type TokenStore,
} from "@mcp-cli/core";
import { apiKeyHeaders, logoutCommand, resolveConnection, type AuthContext } from "../src/auth";

let root = "";
let store: TokenStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-cli-cli-auth-"));
  store = fileTokenStore({ dir: join(root, "mcp-cli", "credentials") });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const plugin = (auth: AuthSpec | undefined, connection: Connection) =>
  definePlugin({ name: "svc", summary: "test", auth, connection: () => connection });
const http: Connection = {
  type: "http",
  url: "https://example.test/mcp",
  headers: { "x-static": "1" },
};

test("api key headers default to a bearer Authorization header", () => {
  expect(apiKeyHeaders({ type: "apiKey", env: "K" }, "k")).toEqual({ Authorization: "Bearer k" });
  expect(apiKeyHeaders({ type: "apiKey", env: "K", header: "x-api-key" }, "k")).toEqual({
    "x-api-key": "k",
  });
  expect(
    apiKeyHeaders({ type: "apiKey", env: "K", header: "Authorization", scheme: "Token" }, "k"),
  ).toEqual({
    Authorization: "Token k",
  });
});

test("api key auth injects headers for HTTP and env for stdio", async () => {
  const spec: AuthSpec = { type: "apiKey", env: "SVC_KEY" };
  expect(await resolveConnection(plugin(spec, http), { SVC_KEY: "k" }, store)).toEqual({
    ...http,
    headers: { "x-static": "1", Authorization: "Bearer k" },
  });
  const stdio: Connection = { type: "stdio", command: "svc", env: { A: "1" } };
  expect(await resolveConnection(plugin(spec, stdio), { SVC_KEY: "k" }, store)).toEqual({
    ...stdio,
    env: { A: "1", SVC_KEY: "k" },
  });
  await expect(resolveConnection(plugin(spec, http), {}, store)).rejects.toThrow(AuthRequiredError);
});

test("oauth auth wires stored credentials unless the connection authorizes itself", async () => {
  const resolved = await resolveConnection(plugin({ type: "oauth" }, http), {}, store);
  if (resolved.type !== "http" || !resolved.authorize) throw new Error("expected authorize");
  await expect(resolved.authorize({ refresh: false })).rejects.toThrow("mcp-cli login svc");
  await store.write("svc", { accessToken: "stored" });
  expect(await resolved.authorize({ refresh: false })).toEqual({ Authorization: "Bearer stored" });
  const own = { ...http, authorize: async () => ({ Authorization: "Bearer own" }) };
  expect(await resolveConnection(plugin({ type: "oauth" }, own), {}, store)).toBe(own);
  expect(await resolveConnection(plugin(undefined, http), {}, store)).toBe(http);
});

test("logout removes stored credentials and rejects bad arguments", async () => {
  const messages: string[] = [];
  const context: AuthContext = {
    env: {},
    store,
    plugin: async () => plugin({ type: "oauth" }, http),
    writeError: (text) => messages.push(text),
    open: () => undefined,
  };
  await store.write("svc", { accessToken: "a" });
  await logoutCommand(["svc"], context);
  expect(await store.read("svc")).toBeUndefined();
  await logoutCommand(["svc"], context);
  expect(messages).toEqual(["Logged out of svc", "No stored credentials for svc"]);
  await expect(logoutCommand([], context)).rejects.toThrow(UsageError);
  await expect(logoutCommand(["svc", "extra"], context)).rejects.toThrow(UsageError);
});

const cli = async (env: Record<string, string>, ...args: string[]) => {
  const child = Bun.spawn(["bun", "apps/cli/src/main.ts", ...args], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, NOTION_MCP_TOKEN: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { stderr, code };
};

test("CLI logout deletes the credentials file under XDG_CONFIG_HOME", async () => {
  await store.write("notion", { accessToken: "a" });
  const result = await cli({ XDG_CONFIG_HOME: root }, "logout", "notion");
  expect(result).toEqual({ stderr: "Logged out of notion\n", code: 0 });
  expect(await readdir(join(root, "mcp-cli", "credentials"))).toEqual([]);
  expect((await cli({ XDG_CONFIG_HOME: root }, "login", "demo")).code).toBe(2);
  expect((await cli({ XDG_CONFIG_HOME: root }, "logout")).code).toBe(2);
});
