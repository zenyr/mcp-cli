import { expect, test } from "bun:test";
import type { AuthorizeRequest, Connection, ToolSession } from "@mcp-cli/core";
import { connect } from "../src";
import { authorizedFetch } from "../src/authorize";
import { startHttpFixture } from "./fixtures/http";

const withSession = async (
  accept: (headers: Headers) => boolean,
  connection: (url: string) => Connection,
  run: (session: ToolSession, seen: Record<string, string | null>[]) => Promise<void>,
) => {
  const fixture = startHttpFixture(["authorization", "x-static"], accept);
  try {
    const session = await connect(connection(fixture.url), { timeoutMs: 2000 });
    try {
      await run(session, fixture.seen);
    } finally {
      await session.close();
    }
  } finally {
    await fixture.stop();
  }
};

const echo = async (session: ToolSession) =>
  expect(await session.callTool("echo", { text: "hi" })).toMatchObject({
    content: [{ type: "text", text: "hi" }],
  });

test("static headers are sent without authorize", () =>
  withSession(
    (headers) => headers.get("x-static") === "1",
    (url) => ({ type: "http", url, headers: { "x-static": "1" } }),
    async (session, seen) => {
      await echo(session);
      expect(seen.every((entry) => entry["x-static"] === "1")).toBe(true);
    },
  ));

test("authorize headers are sent on every request alongside static headers", async () => {
  const calls: AuthorizeRequest[] = [];
  await withSession(
    (headers) => headers.get("authorization") === "Bearer a",
    (url) => ({
      type: "http",
      url,
      headers: { "x-static": "1" },
      authorize: async (request) => {
        calls.push(request);
        return { Authorization: "Bearer a" };
      },
    }),
    async (session, seen) => {
      await echo(session);
      expect(seen.length).toBeGreaterThan(1);
      expect(seen).toEqual(seen.map(() => ({ authorization: "Bearer a", "x-static": "1" })));
      expect(calls.every((call) => !call.refresh)).toBe(true);
      expect(calls.length).toBe(seen.length);
    },
  );
});

test("a 401 triggers exactly one refresh and retry", async () => {
  let token = "stale";
  const calls: AuthorizeRequest[] = [];
  const authorize = async (request: AuthorizeRequest) => {
    calls.push(request);
    if (request.refresh) token = "fresh";
    return { Authorization: `Bearer ${token}` };
  };
  await withSession(
    (headers) => headers.get("authorization") === "Bearer fresh",
    (url) => ({ type: "http", url, authorize }),
    async (session, seen) => {
      expect(calls.filter((call) => call.refresh)).toHaveLength(1);
      expect(seen.slice(0, 2).map((entry) => entry.authorization)).toEqual([
        "Bearer stale",
        "Bearer fresh",
      ]);
      await echo(session);
      expect(calls.filter((call) => call.refresh)).toHaveLength(1);
    },
  );
});

test("a second 401 after refresh surfaces an error without looping", async () => {
  const fixture = startHttpFixture(["authorization"], () => false);
  const calls: AuthorizeRequest[] = [];
  try {
    const connection: Connection = {
      type: "http",
      url: fixture.url,
      authorize: async (request) => {
        calls.push(request);
        return { Authorization: "Bearer bad" };
      },
    };
    await expect(connect(connection, { timeoutMs: 2000 })).rejects.toThrow();
    expect(calls.map((call) => call.refresh)).toEqual([false, true]);
    expect(fixture.seen).toHaveLength(2);
  } finally {
    await fixture.stop();
  }
});

test("concurrent 401s share one refresh", async () => {
  const fixture = startHttpFixture(["authorization"], (headers) => {
    return headers.get("authorization") === "Bearer fresh";
  });
  let token = "stale";
  let refreshes = 0;
  const rejected = Promise.withResolvers<void>();
  try {
    const request = authorizedFetch(async ({ refresh }) => {
      if (refresh) {
        refreshes += 1;
        // Holds the refresh open until both stale requests have been rejected.
        await rejected.promise;
        token = "fresh";
      }
      return { Authorization: `Bearer ${token}` };
    });
    const send = () => request(fixture.url, { method: "POST", body: "{}" });
    const responses = Promise.all([send(), send()]);
    while (fixture.seen.length < 2) await Bun.sleep(1);
    rejected.resolve();
    expect((await responses).map((response) => response.status)).toEqual([202, 202]);
    expect(refreshes).toBe(1);
    expect(fixture.seen.map((entry) => entry.authorization)).toEqual([
      "Bearer stale",
      "Bearer stale",
      "Bearer fresh",
      "Bearer fresh",
    ]);
  } finally {
    await fixture.stop();
  }
});
