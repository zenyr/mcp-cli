import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSettingsStore, fileTokenStore } from "@mcp-cli/auth";
import type { AuthLoginOptions, AuthSupportContext, Tokens } from "@mcp-cli/core";
import { createSlackAuth } from "../src/auth-support";
import { currentProfile, loginSlack, slackOAuthHeaders } from "../src/auth-oauth";
import { decodeSlackConfiguration, readiness, slackSlot } from "../src/auth-config";
import type { SlackConfiguration, SlackTarget } from "../src/auth-types";
import { connectWebApi } from "@mcp-cli/mcp";
import slack from "../src";

let directory: string;
let context: AuthSupportContext;
let configuration: SlackConfiguration;
let requests: { url: string; body: URLSearchParams }[];
let response: Record<string, unknown>;
const secret = () => randomUUID();
const request: typeof fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });
    return Response.json(response);
  },
  { preconnect: fetch.preconnect },
);
const browser: AuthLoginOptions["ui"] = {
  open: async (value) => {
    const url = new URL(value);
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "");
    callback.search = new URLSearchParams({
      code: secret(),
      state: url.searchParams.get("state") ?? "",
    }).toString();
    expect((await fetch(callback)).status).toBe(200);
  },
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "slack-auth-test-"));
  context = {
    env: {},
    store: fileTokenStore({ dir: join(directory, "credentials") }),
    settings: fileSettingsStore(join(directory, "settings")),
  };
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  await reservation.stop(true);
  const profile = {
    method: "pkce" as const,
    clientId: "123.456",
    appId: "ATEST",
    teamId: "TTEST",
    redirectUri: `http://localhost:${port}/callback`,
    scopes: ["channels:read"],
    pkceEnabled: true,
    mcpEnabled: true,
    distribution: "internal" as const,
  };
  configuration = { mcp: { ...profile }, web: { ...profile } };
  await createSlackAuth(request).configure(context, configuration);
  requests = [];
  response = {
    ok: true,
    access_token: secret(),
    refresh_token: secret(),
    token_type: "user",
    expires_in: 3600,
    team: { id: "TTEST" },
    app_id: "ATEST",
  };
});
afterEach(() => rm(directory, { recursive: true, force: true }));

test("both targets use S256, their own endpoints and scope parameter without a client secret", async () => {
  for (const target of ["mcp", "web"] as const) {
    let authorization: URL | undefined;
    await loginSlack(
      context,
      target,
      {
        ui: {
          open: async (value) => {
            authorization = new URL(value);
            await browser.open(value);
          },
        },
      },
      request,
    );
    if (!authorization) throw new Error("Missing authorization request");
    const sent = requests.at(-1);
    const verifier = sent?.body.get("code_verifier") ?? "";
    expect(authorization.pathname).toBe(
      target === "mcp" ? "/oauth/v2_user/authorize" : "/oauth/v2/authorize",
    );
    expect(authorization.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get(target === "mcp" ? "scope" : "user_scope")).toBe(
      "channels:read",
    );
    expect(sent?.url).toBe(
      target === "mcp"
        ? "https://slack.com/api/oauth.v2.user.access"
        : "https://slack.com/api/oauth.v2.access",
    );
    expect(sent?.body.has("client_secret")).toBe(false);
    expect(authorization.searchParams.has("client_secret")).toBe(false);
    expect(sent?.body.get("redirect_uri")).toBe(configuration[target].redirectUri ?? null);
    expect((await context.store.read(slackSlot(target)))?.accessToken).toEqual(
      String(response.access_token),
    );
  }
  expect((await stat(join(directory, "settings/slack.json"))).mode & 0o777).toBe(0o600);
});

test("Web API nested user responses are saved without accidentally selecting the bot token", async () => {
  const userToken = secret();
  response = {
    ok: true,
    access_token: secret(),
    token_type: "bot",
    team: { id: "TTEST" },
    authed_user: {
      id: "UTEST",
      access_token: userToken,
      token_type: "user",
      scope: "channels:read",
    },
  };
  await loginSlack(context, "web", { ui: browser }, request);
  expect((await context.store.read(slackSlot("web")))?.accessToken).toBe(userToken);
});

test("missing PKCE confirmation, unlisted MCP apps and bot browser login never open the browser", async () => {
  expect(readiness({ ...configuration.web, pkceEnabled: false }, "web")).toContain("PKCE");
  expect(readiness({ ...configuration.mcp, distribution: "unlisted" }, "mcp")).toContain(
    "internal",
  );
  expect(
    readiness({ ...configuration.web, redirectUri: "https://example.test/callback" }, "web"),
  ).toContain("localhost");
  configuration.web.pkceEnabled = false;
  await createSlackAuth(request).configure(context, configuration);
  let opens = 0;
  const ui = {
    open: () => {
      opens += 1;
    },
  };
  await expect(loginSlack(context, "web", { ui }, request)).rejects.toThrow();
  await expect(loginSlack(context, "mcp", { ui, credential: "xoxb" }, request)).rejects.toThrow();
  expect(opens).toBe(0);
  expect(requests).toHaveLength(0);
});

test("unexpected workspace, wrong app and errors never overwrite existing credentials or leak responses", async () => {
  const previous: Tokens = { accessToken: secret() };
  await context.store.write(slackSlot("web"), previous);
  for (const invalid of [
    { ...response, team: { id: "TOTHER" } },
    { ...response, app_id: "AOTHER" },
    { ok: false, error: secret(), secret: secret() },
  ]) {
    response = invalid;
    await expect(loginSlack(context, "web", { ui: browser }, request)).rejects.toThrow();
    expect(await context.store.read(slackSlot("web"))).toEqual(previous);
  }
});

test("state mismatch, callback substitution, denial and timeout never exchange a code", async () => {
  for (const kind of ["state", "address", "denied", "timeout"]) {
    await expect(
      loginSlack(
        context,
        "web",
        {
          timeoutMs: 30,
          ui: {
            open: () => undefined,
            manual: (submit) => {
              if (kind !== "timeout")
                submit(
                  `${configuration.web.redirectUri}${kind === "address" ? "/other" : ""}?state=incorrect&${kind === "denied" ? "error=access_denied" : "code=unused"}`,
                );
              return () => undefined;
            },
          },
        },
        request,
      ),
    ).rejects.toThrow();
  }
  expect(requests).toHaveLength(0);
});

test("cancellation releases the listener and a duplicate login is rejected", async () => {
  const opened = Promise.withResolvers<void>();
  const controller = new AbortController();
  const pending = loginSlack(
    context,
    "web",
    { signal: controller.signal, ui: { open: () => opened.resolve() } },
    request,
  );
  await opened.promise;
  await expect(loginSlack(context, "web", { ui: browser }, request)).rejects.toThrow();
  controller.abort();
  await expect(pending).rejects.toThrow();
  await loginSlack(context, "web", { ui: browser }, request);
});

const expire = async (target: SlackTarget) => {
  const tokens = await context.store.read(slackSlot(target));
  if (!tokens) throw new Error("Missing fixture credentials");
  await context.store.write(slackSlot(target), { ...tokens, expiresAt: Date.now() - 1 });
  return tokens;
};

test("concurrent refreshes rotate once and retain stable identity", async () => {
  await loginSlack(context, "web", { ui: browser }, request);
  const previous = await expire("web");
  response = { ...response, access_token: secret(), refresh_token: secret() };
  requests = [];
  const results = await Promise.all(
    Array.from({ length: 6 }, () => slackOAuthHeaders(context, "web", false, request)),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body.get("refresh_token")).toBe(previous.refreshToken ?? null);
  expect(requests[0]?.body.has("code_verifier")).toBe(false);
  expect(new Set(results.map((value) => value.Authorization)).size).toBe(1);
  expect((await context.store.read(slackSlot("web")))?.cacheIdentity).toBe(previous.cacheIdentity);
  expect((await context.store.read(slackSlot("web")))?.refreshToken).toEqual(
    String(response.refresh_token),
  );
});

test("failed refresh retains credentials and invalid grant marks re-login required", async () => {
  await loginSlack(context, "web", { ui: browser }, request);
  const previous = await expire("web");
  response = { ok: false, error: "invalid_grant", detail: secret() };
  await expect(slackOAuthHeaders(context, "web", false, request)).rejects.toThrow("Sign in again");
  const saved = await context.store.read(slackSlot("web"));
  expect(saved?.refreshToken).toBe(previous.refreshToken);
  expect(saved?.client?.reauth).toBe(true);
  expect(
    (await createSlackAuth(request).status(context, false)).find((value) => value.target === "web")
      ?.state,
  ).toBe("reauth");
});

test("configuration changes invalidate old tokens without deleting legacy keys", async () => {
  const legacy = { accessToken: secret() };
  await context.store.write("slack", legacy);
  await loginSlack(context, "mcp", { ui: browser }, request);
  const before = (await currentProfile(context, "mcp")).fingerprint;
  configuration.mcp.teamId = "TOTHER";
  await createSlackAuth(request).configure(context, configuration);
  expect((await currentProfile(context, "mcp")).fingerprint).not.toBe(before);
  await expect(slackOAuthHeaders(context, "mcp", false, request)).rejects.toThrow(
    "settings changed",
  );
  expect(await context.store.read("slack")).toEqual(legacy);
});

test("logout during token exchange prevents a late login from resurrecting credentials", async () => {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const delayed: typeof fetch = Object.assign(
    async () => {
      reached.resolve();
      await release.promise;
      return Response.json(response);
    },
    { preconnect: fetch.preconnect },
  );
  const pending = loginSlack(context, "web", { ui: browser }, delayed);
  await reached.promise;
  await createSlackAuth(request).logout(context, { target: "web" });
  release.resolve();
  await expect(pending).rejects.toThrow("state changed");
  expect(await context.store.read(slackSlot("web"))).toBeUndefined();
});

test("unknown settings and secret fields are rejected", () => {
  expect(() =>
    decodeSlackConfiguration({ web: { method: "pkce", clientSecret: secret() } }),
  ).toThrow();
});

test("manual credentials and environment precedence remain independent from browser credentials", async () => {
  const support = createSlackAuth(request);
  const user = secret();
  const bot = secret();
  await context.store.write("slack", { accessToken: user });
  await context.store.write("slack--xoxb", { accessToken: bot });
  await support.configure(context, { mcp: { method: "token" }, web: { method: "token" } });
  const connection = await slack.connection({});
  const resolved = await support.resolve(context, connection, "xoxp");
  const botConnection = await support.resolve(context, connection, "xoxb");
  if (resolved?.type !== "http" || botConnection?.type !== "http") throw new Error("Expected HTTP");
  expect(await resolved.authorize?.({ refresh: false })).toEqual({
    Authorization: `Bearer ${user}`,
  });
  expect(await botConnection.webApi?.authorize?.({ refresh: false })).toEqual({
    Authorization: `Bearer ${bot}`,
  });
  const environment = secret();
  context.env.SLACK_MCP_TOKEN = environment;
  await support.configure(context, configuration);
  expect(await resolved.authorize?.({ refresh: false })).toEqual({
    Authorization: `Bearer ${environment}`,
  });
  expect(await support.identity(context)).toEqual(await support.identity(context, "xoxp"));
});

test("missing credentials name the login for the selected workspace and target", async () => {
  const named = { ...context, workspace: "two" };
  const support = createSlackAuth(request);
  const connection = await slack.connection({});
  const browserLogin = await support.resolve(named, connection);
  if (browserLogin?.type !== "http") throw new Error("Expected HTTP");
  await expect(browserLogin.authorize?.({ refresh: false })).rejects.toThrow(
    "Sign in to this Slack target first. Run mcp-cli login slack -w two --browser --mcp.",
  );
  await expect(browserLogin.webApi?.authorize?.({ refresh: false })).rejects.toThrow(
    "Run mcp-cli login slack -w two --browser --web.",
  );
  await support.configure(named, { mcp: { method: "token" }, web: { method: "token" } });
  const tokenLogin = await support.resolve(named, connection, "xoxb");
  if (tokenLogin?.type !== "http") throw new Error("Expected HTTP");
  await expect(tokenLogin.webApi?.authorize?.({ refresh: false })).rejects.toThrow(
    "Run mcp-cli login slack -w two --xoxb to paste a Slack bot token.",
  );
});

test("Web API requests use only the web credential and recognize a rotating user token", async () => {
  await loginSlack(context, "web", { ui: browser }, request);
  const support = createSlackAuth(request);
  const resolved = await support.resolve(context, await slack.connection({}), "xoxp");
  if (resolved?.type !== "http") throw new Error("Expected HTTP");
  let authorization = "";
  const webRequest: typeof fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ ok: true });
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(
    resolved,
    async () => {
      throw new Error("MCP must not be opened");
    },
    1000,
    webRequest,
  );
  const result = await session.callTool("web.search.messages", { query: "read only" });
  expect(result.isError).not.toBe(true);
  expect(authorization).toBe(`Bearer ${String(response.access_token)}`);
  expect(await context.store.read(slackSlot("mcp"))).toBeUndefined();
});

test("stored state does not claim connectivity and connection errors do not leak Slack payloads", async () => {
  await loginSlack(context, "web", { ui: browser }, request);
  const states = await createSlackAuth(request).status(context, false);
  expect(states.find((state) => state.target === "web")?.state).toBe("stored");
  expect(JSON.stringify(states)).not.toContain(String(response.access_token));
  const detail = secret();
  const failed: typeof fetch = Object.assign(
    async () => Response.json({ ok: false, error: detail }),
    { preconnect: fetch.preconnect },
  );
  const checked = await createSlackAuth(failed).status(context, true);
  expect(checked.find((state) => state.target === "web")?.state).toBe("reauth");
  expect(JSON.stringify(checked)).not.toContain(detail);
});

test("transport failure and malformed rotation retain credentials without retrying the token exchange", async () => {
  await loginSlack(context, "web", { ui: browser }, request);
  const previous = await expire("web");
  const failure: typeof fetch = Object.assign(
    async () => {
      throw new Error(secret());
    },
    { preconnect: fetch.preconnect },
  );
  await expect(slackOAuthHeaders(context, "web", false, failure)).rejects.toThrow(
    "did not complete",
  );
  expect((await context.store.read(slackSlot("web")))?.refreshToken).toBe(previous.refreshToken);
  response = { ...response, refresh_token: undefined };
  await expect(slackOAuthHeaders(context, "web", false, request)).rejects.toThrow("omitted");
  expect((await context.store.read(slackSlot("web")))?.refreshToken).toBe(previous.refreshToken);
});

test("retired auto settings require a manual choice without deleting tokens or inspecting the app", async () => {
  const retained = { accessToken: secret() };
  await context.store.write(slackSlot("mcp"), retained);
  await context.settings.write("slack", {
    configuration: { mcp: { ...configuration.mcp, method: "auto" }, web: { method: "token" } },
    revision: secret(),
  });
  const support = createSlackAuth(request);
  expect((await support.configuration(context)).mcp).toMatchObject({ method: "choose" });
  await expect(currentProfile(context, "mcp")).rejects.toThrow("Choose token input");
  expect(
    (await support.status(context, false)).find((value) => value.target === "mcp")?.state,
  ).toBe("reauth");
  await expect(support.configure(context, { mcp: { method: "auto" } })).rejects.toThrow();
  await support.configure(context, { mcp: { method: "token" }, web: { method: "token" } });
  expect(await context.store.read(slackSlot("mcp"))).toEqual(retained);
  expect(requests).toHaveLength(0);
});

test("manual-choice requirements do not block explicitly supplied environment or bot credentials", async () => {
  await context.settings.write("slack", {
    configuration: { mcp: { method: "auto" }, web: { method: "auto" } },
  });
  const token = secret();
  await context.store.write("slack--xoxb", { accessToken: token });
  const support = createSlackAuth(request);
  const connection = await slack.connection({});
  const bot = await support.resolve(context, connection, "xoxb");
  expect(bot?.type === "http" && (await bot.authorize?.({ refresh: false }))).toEqual({
    Authorization: `Bearer ${token}`,
  });
  context.env.SLACK_MCP_TOKEN = token;
  const user = await support.resolve(context, connection, "xoxp");
  expect(user?.type === "http" && (await user.authorize?.({ refresh: false }))).toEqual({
    Authorization: `Bearer ${token}`,
  });
  expect(requests).toHaveLength(0);
});
