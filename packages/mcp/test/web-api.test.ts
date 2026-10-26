import { expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord, type Connection } from "@mcp-cli/core";
import { connectWebApi } from "../src/web-api";
const config: Extract<Connection, { type: "http" }> = {
  type: "http",
  url: "http://127.0.0.1:1/mcp",
  headers: { Authorization: "Bearer xoxp-fixture" },
  webApi: {
    url: "https://slack.com/api/",
    downloadHosts: ["files.slack.com"],
    tools: [
      { name: "read", method: "users.list", inputSchema: {}, annotations: { readOnlyHint: true } },
      { name: "write", method: "chat.postMessage", inputSchema: {} },
      { name: "download", method: "download", download: true, inputSchema: {} },
    ],
  },
};
const noMcp = async (): Promise<never> => {
  throw new Error("MCP must not open");
};

test("late authentication failures share a refresh and writes are not replayed", async () => {
  const original = crypto.randomUUID();
  const next = crypto.randomUUID();
  let current = original;
  let refreshes = 0;
  let oldReads = 0;
  let writes = 0;
  const release = Promise.withResolvers<void>();
  const request: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("chat.postMessage")) {
        writes += 1;
        return Response.json({ ok: false, error: "invalid_auth" });
      }
      if (new Headers(init?.headers).get("authorization") === `Bearer ${original}`) {
        oldReads += 1;
        if (oldReads === 2) await release.promise;
        return Response.json({ ok: false, error: "invalid_auth" });
      }
      release.resolve();
      return Response.json({ ok: true });
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(
    {
      ...config,
      authorize: async ({ refresh }) => {
        if (refresh) {
          refreshes += 1;
          current = next;
        }
        return { Authorization: `Bearer ${current}` };
      },
    },
    noMcp,
    1000,
    request,
  );
  const results = await Promise.all([session.callTool("read", {}), session.callTool("read", {})]);
  expect(results.every((value) => !value.isError)).toBe(true);
  expect(refreshes).toBe(1);
  await session.callTool("write", {});
  expect(writes).toBe(1);
  expect(refreshes).toBe(1);
});

test("per-tool form encoding preserves values and leaves JSON requests unchanged", async () => {
  const input = {
    query: 'in:general "배포 완료" & + # = %',
    count: 1,
    enabled: false,
    profile: { text: "hello" },
    blocks: ["one", "two"],
    empty: "",
    omitted: undefined,
  };
  const seen: Request[] = [];
  const request: typeof fetch = Object.assign(
    async (url: string | URL | Request, options?: RequestInit) => {
      seen.push(new Request(url, options));
      return Response.json({ ok: true });
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(
    {
      ...config,
      webApi: {
        url: "https://slack.com/api/",
        tools: [
          { name: "form", method: "search.messages", inputSchema: {}, bodyEncoding: "form" },
          { name: "json", method: "chat.postMessage", inputSchema: {} },
        ],
      },
    },
    noMcp,
    100,
    request,
  );
  for (const name of ["form", "json"]) await session.callTool(name, input);
  const [form, json] = seen;
  if (!form || !json) throw new Error("Missing requests");
  expect(form.method).toBe("POST");
  expect(form.url).toBe("https://slack.com/api/search.messages");
  expect(form.headers.get("authorization")).toBe("Bearer xoxp-fixture");
  expect(form.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  expect(Object.fromEntries(new URLSearchParams(await form.text()))).toEqual({
    query: input.query,
    count: "1",
    enabled: "false",
    profile: '{"text":"hello"}',
    blocks: '["one","two"]',
    empty: "",
  });
  expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await json.json()).toEqual(JSON.parse(JSON.stringify(input)));
});

test("429 preserves Retry-After; writes are not retried; read zero-delay retries once", async () => {
  let calls = 0;
  const request: typeof fetch = Object.assign(
    async () => {
      calls++;
      return Response.json(
        { ok: false, error: "ratelimited" },
        { status: 429, headers: { "retry-after": "0" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(config, noMcp, 100, request);
  expect((await session.callTool("write", {})).structuredContent).toMatchObject({
    category: "rate_limit",
    retryAfter: "0",
  });
  expect(calls).toBe(1);
  await session.callTool("read", {});
  expect(calls).toBe(3);
});

test("network failure and server failure preserve uncertain writes without retry", async () => {
  let calls = 0;
  const request: typeof fetch = Object.assign(
    async () => {
      calls++;
      throw new Error("timeout");
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(config, noMcp, 1, request);
  expect((await session.callTool("write", {})).structuredContent).toMatchObject({
    category: "network",
    outcome: "unknown",
  });
  expect(calls).toBe(1);
});

test("download rejects non-HTTPS and unapproved hosts before authentication", async () => {
  let calls = 0;
  const request: typeof fetch = Object.assign(
    async () => {
      calls++;
      return new Response("text");
    },
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(config, noMcp, 100, request);
  for (const url of [
    "http://files.slack.com/a",
    "https://evil.test/a",
    "https://files.slack.com.evil.test/a",
    "https://user:pass@files.slack.com/a",
  ])
    expect((await session.callTool("download", { url })).isError).toBe(true);
  expect(calls).toBe(0);
});

test("downloads enforce declared and streamed 5 MiB limits and refuse redirects", async () => {
  for (const response of [
    new Response("small", { headers: { "content-length": String(5 * 1024 * 1024 + 1) } }),
    new Response(new Uint8Array(5 * 1024 * 1024 + 1)),
    new Response(null, { status: 302, headers: { location: "https://evil.test/secret" } }),
  ]) {
    let seen: RequestInit | undefined;
    const request: typeof fetch = Object.assign(
      async (_url: string | URL | Request, options?: RequestInit) => {
        seen = options;
        return response;
      },
      { preconnect: fetch.preconnect },
    );
    const result = await connectWebApi(config, noMcp, 100, request).callTool("download", {
      url: "https://files.slack.com/file",
    });
    expect(result.isError).toBe(true);
    expect(seen?.redirect).toBe("error");
  }
});

test("binary content uses base64 and saved files use private random paths", async () => {
  const request: typeof fetch = Object.assign(
    async () =>
      new Response(new Uint8Array([0, 255, 1]), {
        headers: { "content-type": "application/octet-stream" },
      }),
    { preconnect: fetch.preconnect },
  );
  const session = connectWebApi(config, noMcp, 100, request);
  expect(
    (await session.callTool("download", { url: "https://files.slack.com/file" })).structuredContent,
  ).toMatchObject({ content: "AP8B", encoding: "base64", untrusted: true });
  const result = await session.callTool("download", {
    url: "https://files.slack.com/file",
    save: true,
  });
  const data = isRecord(result.structuredContent) ? result.structuredContent : {};
  expect(typeof data.path).toBe("string");
  if (typeof data.path !== "string") throw new Error("Missing saved path");
  try {
    expect((await stat(dirname(data.path))).mode & 0o777).toBe(0o700);
    expect((await stat(data.path)).mode & 0o777).toBe(0o600);
    expect(await readFile(data.path)).toEqual(Buffer.from([0, 255, 1]));
  } finally {
    await rm(dirname(data.path), { recursive: true, force: true });
  }
});

test("HTTP request timeout is bounded and a write is sent only once", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ ok: true });
    },
  });
  const session = connectWebApi(
    {
      ...config,
      webApi: { ...config.webApi, url: String(server.url), tools: config.webApi?.tools ?? [] },
    },
    noMcp,
    5,
  );
  try {
    const result = await session.callTool("write", {});
    expect(result.structuredContent).toMatchObject({
      category: "network",
      error: "timeout",
      outcome: "unknown",
    });
    expect(calls).toBe(1);
  } finally {
    await session.close();
    server.stop(true);
  }
});
