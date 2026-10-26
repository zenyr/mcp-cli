import { expect, test } from "bun:test";
import type { Connection, Tokens, TokenStore } from "@mcp-cli/core";
import { connect, oauthAuthorize } from "../src";
import { startHttpFixture } from "./fixtures/http";

const statuses = [307, 308] as const;
const headerNames = ["x-static", "x-private", "authorization"];
const authModes = ["static", "authorized"] as const;
const connection = (url: string, mode: (typeof authModes)[number]): Connection => ({
  type: "http",
  url,
  headers: { "x-static": "static-secret" },
  ...(mode === "authorized" && {
    authorize: async () => ({ Authorization: "Bearer private-token", "x-private": "secret" }),
  }),
});

for (const status of statuses) {
  for (const mode of authModes) {
    test(`${status} cannot send ${mode} MCP headers to another origin`, async () => {
      const target = startHttpFixture(headerNames, () => true);
      const source = startHttpFixture(headerNames, () => true, { status, target: target.url });
      try {
        await expect(
          connect(connection(`${source.url}redirect`, mode), { timeoutMs: 2000 }),
        ).rejects.toThrow();
        expect(source.seen.length).toBeGreaterThan(0);
        expect(source.seen[0]?.["x-static"]).toBe("static-secret");
        if (mode === "authorized")
          expect(source.seen[0]?.authorization).toBe("Bearer private-token");
        expect(target.seen).toHaveLength(0);
      } finally {
        await source.stop();
        await target.stop();
      }
    });

    test(`${status} preserves ${mode} MCP headers on the same origin`, async () => {
      const source = startHttpFixture(headerNames, () => true, { status });
      try {
        const session = await connect(connection(`${source.url}redirect`, mode), {
          timeoutMs: 2000,
        });
        try {
          expect(await session.callTool("echo", { text: "redirected" })).toMatchObject({
            content: [{ type: "text", text: "redirected" }],
          });
          expect(source.seen.length).toBeGreaterThan(2);
          expect(source.seen.every((entry) => entry["x-static"] === "static-secret")).toBe(true);
          if (mode === "authorized")
            expect(
              source.seen.every(
                (entry) =>
                  entry.authorization === "Bearer private-token" && entry["x-private"] === "secret",
              ),
            ).toBe(true);
        } finally {
          await session.close();
        }
      } finally {
        await source.stop();
      }
    });
  }
}

type TokenRequest = { path: string; authorization: string | null; body: URLSearchParams };
const startTokenServer = (status: 307 | 308, target?: string) => {
  const seen: TokenRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      seen.push({
        path,
        authorization: request.headers.get("authorization"),
        body: new URLSearchParams(await request.text()),
      });
      if (path === "/token")
        return Response.redirect(target ?? new URL("/rotated", request.url).href, status);
      return Response.json({ access_token: "next-access", token_type: "Bearer" });
    },
  });
  return { url: server.url.origin, seen, stop: () => server.stop(true) };
};

const refreshAt = (url: string, method: "client_secret_post" | "client_secret_basic") => {
  let stored: Tokens | undefined = {
    accessToken: "expired-access",
    refreshToken: "private-refresh",
    expiresAt: 1,
    client: {
      serverUrl: `${url}/mcp`,
      authorizationServer: url,
      issuer: url,
      authorizationEndpoint: `${url}/authorize`,
      tokenEndpoint: `${url}/token`,
      clientId: "client-id",
      clientSecret: "private-client-secret",
      clientAuthMethod: method,
      authMethods: [method],
    },
  };
  const store: TokenStore = {
    read: async () => stored,
    write: async (_service, tokens) => {
      stored = tokens;
    },
    delete: async () => {
      stored = undefined;
    },
    withLock: async (_service, run) => run(),
  };
  return { authorize: oauthAuthorize({ service: "svc", url: `${url}/mcp`, store }), store };
};

for (const status of statuses) {
  for (const method of ["client_secret_post", "client_secret_basic"] as const) {
    test(`${status} cannot forward OAuth ${method} credentials to another origin`, async () => {
      const target = startTokenServer(status);
      const source = startTokenServer(status, `${target.url}/rotated`);
      const { authorize, store } = refreshAt(source.url, method);
      try {
        await expect(authorize({ refresh: false })).rejects.toThrow();
        expect(source.seen).toHaveLength(1);
        expect(source.seen[0]?.body.get("refresh_token")).toBe("private-refresh");
        if (method === "client_secret_post")
          expect(source.seen[0]?.body.get("client_secret")).toBe("private-client-secret");
        else
          expect(source.seen[0]?.authorization).toBe(
            `Basic ${btoa("client-id:private-client-secret")}`,
          );
        expect(target.seen).toHaveLength(0);
        expect((await store.read("svc"))?.accessToken).toBe("expired-access");
      } finally {
        await source.stop();
        await target.stop();
      }
    });

    test(`${status} allows same-origin OAuth ${method} refresh`, async () => {
      const source = startTokenServer(status);
      const { authorize, store } = refreshAt(source.url, method);
      try {
        expect(await authorize({ refresh: false })).toEqual({
          Authorization: "Bearer next-access",
        });
        expect(source.seen.map((request) => request.path)).toEqual(["/token", "/rotated"]);
        expect(source.seen[1]?.body.toString()).toBe(source.seen[0]?.body.toString());
        expect(source.seen[1]?.authorization).toBe(source.seen[0]?.authorization);
        expect(
          source.seen.every((request) => request.body.get("refresh_token") === "private-refresh"),
        ).toBe(true);
        expect((await store.read("svc"))?.accessToken).toBe("next-access");
      } finally {
        await source.stop();
      }
    });
  }
}
