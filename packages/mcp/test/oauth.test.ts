import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileTokenStore } from "@mcp-cli/auth";
import { AuthRequiredError, type TokenStore } from "@mcp-cli/core";
import { connect, login, LoginError, oauthAuthorize } from "../src";
import { startHttpFixture } from "./fixtures/http";
import { startFakeAuthServer, type FakeAuthServer } from "./fixtures/oauth";

let root = "";
let fake: FakeAuthServer;
let store: TokenStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcp-cli-oauth-"));
  store = fileTokenStore({ dir: root });
  fake = startFakeAuthServer();
});
afterEach(async () => {
  await fake.stop();
  await rm(root, { recursive: true, force: true });
});

// Simulates the browser: the fake server redirects straight to the loopback callback.
const browser = { open: async (url: string) => void (await fetch(url)) };
const signIn = (overrides: Partial<Parameters<typeof login>[0]> = {}) =>
  login({
    service: "svc",
    url: fake.resource,
    spec: { type: "oauth" },
    store,
    ui: browser,
    ...overrides,
  });

test("login discovers, registers, runs PKCE on a loopback redirect and stores tokens", async () => {
  const tokens = await signIn();
  expect(tokens).toMatchObject({
    accessToken: "access-1",
    refreshToken: "refresh-1",
    tokenType: "Bearer",
  });
  expect(await store.read("svc")).toEqual(tokens);
  const [registration] = fake.registrations;
  expect(registration).toMatchObject({
    client_name: "mcp-cli",
    token_endpoint_auth_method: "none",
  });
  const redirect = String(registration?.redirect_uris).replace(/\d+\/callback$/, "PORT/callback");
  expect(redirect).toBe("http://127.0.0.1:PORT/callback");
  const [authorize] = fake.authorizeRequests;
  expect(authorize?.get("client_id")).toBe("client-1");
  expect(authorize?.get("code_challenge_method")).toBe("S256");
  expect(authorize?.get("resource")).toBe(fake.resource);
  expect(authorize?.get("scope")).toBe("read write");
  expect(fake.tokenRequests[0]?.get("resource")).toBe(fake.resource);
  expect(tokens.client).toMatchObject({ serverUrl: fake.resource, clientId: "client-1" });
});

test("login accepts a pasted redirect URL when the browser runs elsewhere", async () => {
  let authorizeUrl = "";
  const tokens = await signIn({
    ui: {
      open: (url) => void (authorizeUrl = url),
      manual: (submit) => {
        void fetch(authorizeUrl, { redirect: "manual" }).then((response) =>
          submit(`  ${response.headers.get("location") ?? ""}  `),
        );
        return () => undefined;
      },
    },
  });
  expect(tokens.accessToken).toBe("access-1");
});

test("a pasted redirect with the wrong state fails the login", async () => {
  await expect(
    signIn({
      ui: {
        open: () => undefined,
        manual: (submit) => {
          submit("http://127.0.0.1:1/callback?code=x&state=forged");
          return () => undefined;
        },
      },
    }),
  ).rejects.toBeInstanceOf(LoginError);
  expect(await store.read("svc")).toBeUndefined();
});

test("login uses a pre-registered client id and plugin scopes without registration", async () => {
  await signIn({ spec: { type: "oauth", clientId: "fixed", scopes: ["read"] } });
  expect(fake.registrations).toHaveLength(0);
  expect(fake.authorizeRequests[0]?.get("client_id")).toBe("fixed");
  expect(fake.authorizeRequests[0]?.get("scope")).toBe("read");
});

test("login fails on denial, state mismatch and timeout without storing tokens", async () => {
  fake.redirect = { error: "access_denied" };
  await expect(signIn()).rejects.toThrow(LoginError);
  fake.redirect = { state: "forged" };
  await expect(signIn()).rejects.toThrow("state does not match");
  fake.redirect = {};
  await expect(signIn({ ui: { open: () => undefined }, timeoutMs: 100 })).rejects.toThrow(
    "timed out",
  );
  expect(await store.read("svc")).toBeUndefined();
});

const authorizeFor = (now = Date.now) =>
  oauthAuthorize({ service: "svc", url: fake.resource, store, now });

test("valid tokens are sent without refreshing", async () => {
  await signIn();
  expect(await authorizeFor()({ refresh: false })).toEqual({ Authorization: "Bearer access-1" });
  expect(fake.refreshCount()).toBe(0);
});

test("expired tokens refresh once under the lock across concurrent authorizers", async () => {
  const initial = await signIn();
  await store.write("svc", { ...initial, cacheIdentity: "workflow-login" });
  fake.refreshDelayMs = 100;
  const later = () => Date.now() + 3600 * 1000;
  // Separate authorizers stand in for separate CLI processes sharing the credential file.
  const results = await Promise.all([
    authorizeFor(later)({ refresh: false }),
    authorizeFor(later)({ refresh: false }),
  ]);
  expect(fake.refreshCount()).toBe(1);
  expect(results).toEqual([
    { Authorization: "Bearer access-2" },
    { Authorization: "Bearer access-2" },
  ]);
  expect(await store.read("svc")).toMatchObject({
    accessToken: "access-2",
    refreshToken: "refresh-2",
    cacheIdentity: "workflow-login",
  });
  expect(fake.tokenRequests.at(-1)?.get("resource")).toBe(fake.resource);
});

test("separate processes refresh a rotating token without double use", async () => {
  await signIn();
  fake.refreshDelayMs = 150;
  const spawnChild = (refresh: boolean) =>
    Bun.spawn(
      [
        "bun",
        join(import.meta.dir, "fixtures", "refresh-child.ts"),
        root,
        fake.resource,
        String(refresh),
      ],
      { stdout: "pipe", stderr: "inherit" },
    );
  const run = async (flags: boolean[]) => {
    const children = flags.map(spawnChild);
    const outputs = await Promise.all(children.map((child) => new Response(child.stdout).text()));
    expect(await Promise.all(children.map((child) => child.exited))).toEqual(flags.map(() => 0));
    return outputs.map((text) => JSON.parse(text).Authorization);
  };
  expect(new Set(await run([false, false, false, false, false, false]))).toEqual(
    new Set(["Bearer access-2"]),
  );
  expect(fake.refreshCount()).toBe(1);
  // Concurrent forced refreshes after a 401 also collapse into one rotation.
  expect(new Set(await run([true, true, true]))).toEqual(new Set(["Bearer access-3"]));
  expect(fake.refreshCount()).toBe(2);
  expect(await store.read("svc")).toMatchObject({ accessToken: fake.current().access });
});

test("a forced refresh rotates tokens and a stale concurrent refresh reuses them", async () => {
  await signIn();
  const authorize = authorizeFor();
  expect(await authorize({ refresh: true })).toEqual({ Authorization: "Bearer access-2" });
  expect(await authorize({ refresh: true })).toEqual({ Authorization: "Bearer access-3" });
  expect(fake.refreshCount()).toBe(2);
});

test("missing, rejected and foreign credentials require login", async () => {
  await expect(authorizeFor()({ refresh: false })).rejects.toThrow(AuthRequiredError);
  await signIn();
  const tokens = await store.read("svc");
  if (!tokens) throw new Error("expected tokens");
  await store.write("svc", { ...tokens, refreshToken: "revoked" });
  await expect(authorizeFor()({ refresh: true })).rejects.toThrow("mcp-cli login svc");
  const other = oauthAuthorize({ service: "svc", url: `${fake.base}/other`, store });
  await expect(other({ refresh: false })).rejects.toThrow(AuthRequiredError);
  await store.write("svc", { accessToken: "static", expiresAt: 1 });
  await expect(authorizeFor()({ refresh: false })).rejects.toThrow(AuthRequiredError);
});

test("connect surfaces missing credentials as AuthRequiredError", async () => {
  const fixture = startHttpFixture(["authorization"], () => true);
  try {
    const authorize = oauthAuthorize({ service: "svc", url: fixture.url, store });
    await expect(
      connect({ type: "http", url: fixture.url, authorize }, { timeoutMs: 2000 }),
    ).rejects.toThrow(AuthRequiredError);
  } finally {
    await fixture.stop();
  }
});

test("stored tokens authorize a real MCP session", async () => {
  const fixture = startHttpFixture(
    ["authorization"],
    (headers) => headers.get("authorization") === "Bearer ok",
  );
  try {
    await store.write("svc", { accessToken: "ok" });
    const authorize = oauthAuthorize({ service: "svc", url: fixture.url, store });
    const session = await connect(
      { type: "http", url: fixture.url, authorize },
      { timeoutMs: 2000 },
    );
    await session.close();
    expect(fixture.seen.every((entry) => entry.authorization === "Bearer ok")).toBe(true);
  } finally {
    await fixture.stop();
  }
});
