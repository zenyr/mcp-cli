import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSettingsStore, fileTokenStore } from "../../../packages/auth/src";
import type { AuthSupportContext } from "@mcp-cli/core";
import { createSlackAuth } from "../src/auth-support";
import { detectedSettings, effectiveProfile, inspectSlackApp } from "../src/auth-detection";
import { loginSlack } from "../src/auth-oauth";
import type { SlackProfile } from "../src/auth-types";

let directory: string;
let context: AuthSupportContext;
const profile: SlackProfile = {
  method: "auto",
  appId: "ATEST",
  clientId: "123.456",
  teamId: "TTEST",
  redirectUri: "http://localhost:8765/callback",
  scopes: ["channels:read"],
  distribution: "internal",
};
let data: unknown;
let calls: { url: string; init?: RequestInit }[];
const request: typeof fetch = Object.assign(
  async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(data);
  },
  { preconnect: fetch.preconnect },
);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "slack-detection-test-"));
  context = {
    env: {},
    settings: fileSettingsStore(join(directory, "settings")),
    store: fileTokenStore({ dir: join(directory, "credentials") }),
  };
  await createSlackAuth(request).configure(context, { mcp: profile, web: profile });
  data = {
    ok: true,
    manifest: {
      oauth_config: {
        pkce_enabled: true,
        redirect_urls: [profile.redirectUri],
        scopes: { user: profile.scopes },
      },
      settings: { token_rotation_enabled: false, is_mcp_enabled: true },
    },
  };
  calls = [];
});
afterEach(() => rm(directory, { recursive: true, force: true }));

test("manifest detection reads both settings and stores the inspection credential separately", async () => {
  const secret = randomUUID();
  const detected = await inspectSlackApp(context, "web", { secret }, request);
  expect(detected).toMatchObject({
    pkce: true,
    rotation: false,
    mcp: true,
    available: true,
    appId: "ATEST",
  });
  expect(calls[0]?.url).toBe("https://slack.com/api/apps.manifest.export");
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ app_id: "ATEST" });
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
  expect(await effectiveProfile(context, profile, "web")).toMatchObject({
    method: "pkce",
    pkceEnabled: true,
  });
  const settings = await readdir(join(directory, "settings"));
  for (const file of settings)
    expect(await readFile(join(directory, "settings", file), "utf8")).not.toContain(secret);
  expect(await context.store.read("slack")).toBeUndefined();
  calls = [];
  await inspectSlackApp(context, "mcp", {}, request);
  expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(`Bearer ${secret}`);
});

test("missing manifest flags stay unknown and do not select token authentication", async () => {
  data = { ok: true, manifest: { settings: {} } };
  const detected = await inspectSlackApp(context, "web", { secret: randomUUID() }, request);
  expect(detected.pkce).toBeUndefined();
  expect(detected.rotation).toBeUndefined();
  await expect(effectiveProfile(context, profile, "web")).rejects.toThrow("unknown");
});

test("detected PKCE-off selects legacy token while rotation remains an independent flag", async () => {
  data = {
    ok: true,
    manifest: { oauth_config: { pkce_enabled: false }, settings: { token_rotation_enabled: true } },
  };
  await inspectSlackApp(context, "web", { secret: randomUUID() }, request);
  expect(await effectiveProfile(context, { ...profile, pkceEnabled: true }, "web")).toMatchObject({
    method: "token",
    pkceEnabled: false,
  });
  expect((await detectedSettings(context, "ATEST")).rotation).toBe(true);
  const token = randomUUID();
  await context.store.write("slack", { accessToken: token });
  const resolved = await createSlackAuth(request).resolve(
    context,
    { type: "http", url: "https://mcp.slack.com/mcp" },
    "xoxp",
  );
  expect(resolved?.type === "http" && (await resolved.authorize?.({ refresh: false }))).toEqual({
    Authorization: `Bearer ${token}`,
  });
});

test("a failed lookup invalidates old evidence, preserves credentials and redacts server errors", async () => {
  const secret = randomUUID();
  await inspectSlackApp(context, "web", { secret }, request);
  data = { ok: false, error: secret };
  try {
    await inspectSlackApp(context, "web", {}, request);
    throw new Error("Expected rejection");
  } catch (error) {
    expect(String(error)).not.toContain(secret);
  }
  expect((await detectedSettings(context, "ATEST")).available).toBe(false);
  await expect(effectiveProfile(context, profile, "web")).rejects.toThrow("unknown");
});

test("inspection credentials and evidence do not cross App IDs and forgetting does not delete user tokens", async () => {
  await inspectSlackApp(context, "web", { secret: randomUUID() }, request);
  await createSlackAuth(request).configure(context, { web: { ...profile, appId: "AOTHER" } });
  await expect(inspectSlackApp(context, "web", {}, request)).rejects.toThrow("configuration token");
  await createSlackAuth(request).configure(context, { web: profile });
  const token = randomUUID();
  await context.store.write("slack", { accessToken: token });
  await inspectSlackApp(context, "web", { forget: true }, request);
  expect((await detectedSettings(context, "ATEST")).available).toBe(false);
  expect((await context.store.read("slack"))?.accessToken).toBe(token);
  await expect(inspectSlackApp(context, "web", {}, request)).rejects.toThrow("configuration token");
});

test("auto login rechecks remote settings before opening a browser", async () => {
  await inspectSlackApp(context, "web", { secret: randomUUID() }, request);
  data = { ok: true, manifest: { oauth_config: { pkce_enabled: false } } };
  let opened = false;
  await expect(
    loginSlack(
      context,
      "web",
      {
        ui: {
          open: () => {
            opened = true;
          },
        },
      },
      request,
    ),
  ).rejects.toThrow("browser login");
  expect(opened).toBe(false);
  expect(calls).toHaveLength(2);
});

test("auto login validates redirect URI and requested scopes against the manifest", async () => {
  await inspectSlackApp(context, "web", { secret: randomUUID() }, request);
  await expect(
    effectiveProfile(context, { ...profile, redirectUri: "http://localhost:9876/callback" }, "web"),
  ).rejects.toThrow("redirect URL");
  await expect(
    effectiveProfile(context, { ...profile, scopes: ["chat:write"] }, "web"),
  ).rejects.toThrow("user scopes");
});

test("unknown auto settings never block explicit bot tokens or environment credentials", async () => {
  const token = randomUUID();
  await context.store.write("slack--xoxb", { accessToken: token });
  const support = createSlackAuth(request);
  const base = { type: "http" as const, url: "https://mcp.slack.com/mcp" };
  const bot = await support.resolve(context, base, "xoxb");
  expect(bot?.type === "http" && (await bot.authorize?.({ refresh: false }))).toEqual({
    Authorization: `Bearer ${token}`,
  });
  context.env.SLACK_MCP_TOKEN = token;
  const user = await support.resolve(context, base, "xoxp");
  expect(user?.type === "http" && (await user.authorize?.({ refresh: false }))).toEqual({
    Authorization: `Bearer ${token}`,
  });
  expect(calls).toHaveLength(0);
});
