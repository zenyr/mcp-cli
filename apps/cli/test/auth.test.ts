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
import {
  apiKeyHeaders,
  canOpenBrowser,
  loginCommand,
  logoutCommand,
  resolveConnection,
  type AuthContext,
} from "../src/auth";

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

const slackLike: AuthSpec = {
  type: "apiKey",
  env: "SVC_KEY",
  alternates: [{ flag: "xoxb", env: "SVC_BOT_KEY", summary: "Use the bot token" }],
};
const keyContext = (secret: string, messages: string[] = []): AuthContext => ({
  env: {},
  store,
  plugin: async () => plugin(slackLike, http),
  writeError: (text) => messages.push(text),
  open: () => undefined,
  readSecret: async () => secret,
});
const bearer = async (env: Record<string, string>, credential?: string) => {
  const resolved = await resolveConnection(plugin(slackLike, http), env, store, credential);
  return resolved.type === "http" ? resolved.headers?.Authorization : undefined;
};

test("login stores API keys per credential and the environment still wins", async () => {
  const messages: string[] = [];
  await loginCommand(["svc"], keyContext(" xoxp-user\n", messages));
  await loginCommand(["svc", "--xoxb"], keyContext("xoxb-bot", messages));
  expect(await bearer({})).toBe("Bearer xoxp-user");
  expect(await bearer({}, "xoxb")).toBe("Bearer xoxb-bot");
  expect(await bearer({ SVC_KEY: "env-user", SVC_BOT_KEY: "env-bot" })).toBe("Bearer env-user");
  expect(await bearer({ SVC_BOT_KEY: "env-bot" }, "xoxb")).toBe("Bearer env-bot");
  expect(messages[0]).toContain("Saved SVC_KEY for svc");
  expect(messages.join("\n")).not.toContain("xoxp-user");
  await logoutCommand(["svc", "--xoxb"], keyContext(""));
  expect(await bearer({})).toBe("Bearer xoxp-user");
  await expect(bearer({}, "xoxb")).rejects.toThrow("mcp-cli login svc --xoxb");
});

test("credential flags are validated for login, logout and connections", async () => {
  await expect(loginCommand(["svc"], keyContext("  "))).rejects.toThrow("No key was entered");
  await expect(loginCommand(["svc", "--bot"], keyContext("k"))).rejects.toThrow("Unknown option");
  await expect(loginCommand(["svc", "--xoxb", "--xoxb"], keyContext("k"))).resolves.toBeUndefined();
  await expect(bearer({}, "bot")).rejects.toThrow("no --bot credential");
  await expect(
    resolveConnection(plugin({ type: "oauth" }, http), {}, store, "xoxb"),
  ).rejects.toThrow(UsageError);
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
    readSecret: async () => "",
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
    env: { ...process.env, DEMO_AUTH_TOKEN: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  return { stderr, code };
};

test("CLI logout deletes the credentials file under XDG_CONFIG_HOME", async () => {
  await store.write("demo-auth", { accessToken: "a" });
  const result = await cli({ XDG_CONFIG_HOME: root }, "logout", "demo-auth");
  expect(result).toEqual({ stderr: "Logged out of demo-auth\n", code: 0 });
  // The empty flock file stays so concurrent holders never lock different inodes.
  expect(await readdir(join(root, "mcp-cli", "credentials"))).toEqual(["demo-auth.lock"]);
  expect((await cli({ XDG_CONFIG_HOME: root }, "login", "demo")).code).toBe(2);
  expect((await cli({ XDG_CONFIG_HOME: root }, "logout")).code).toBe(2);
});

test("browser launch is skipped for SSH, missing displays and MCP_CLI_NO_BROWSER", () => {
  expect(canOpenBrowser({}, "darwin")).toBe(true);
  expect(canOpenBrowser({ MCP_CLI_NO_BROWSER: "1" }, "darwin")).toBe(false);
  expect(canOpenBrowser({ SSH_CONNECTION: "1 2 3 4" }, "darwin")).toBe(false);
  expect(canOpenBrowser({}, "linux")).toBe(false);
  expect(canOpenBrowser({ DISPLAY: ":0" }, "linux")).toBe(true);
});

test("explicit base credential selection uses the base slot and environment bypasses broken storage", async () => {
  const { default: demoAuth } = await import("../../../plugins/demo-auth/src");
  await store.write("demo-auth", { accessToken: "user-stored-fixture" });
  await store.write("demo-auth--bot", { accessToken: "bot-stored-fixture" });
  const user = await resolveConnection(demoAuth, {}, store, "user");
  const bot = await resolveConnection(demoAuth, {}, store, "bot");
  expect(user.type === "http" && user.headers?.Authorization).toBe("Bearer user-stored-fixture");
  expect(bot.type === "http" && bot.headers?.Authorization).toBe("Bearer bot-stored-fixture");
  const broken = {
    ...store,
    read: async () => {
      throw new Error("Corrupt storage");
    },
  };
  const env = await resolveConnection(
    demoAuth,
    { DEMO_AUTH_TOKEN: "user-env-fixture" },
    broken,
    "user",
  );
  expect(env.type === "http" && env.headers?.Authorization).toBe("Bearer user-env-fixture");
});
