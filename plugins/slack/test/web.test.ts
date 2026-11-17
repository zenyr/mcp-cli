import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord, type ServicePlugin, type RepeatGuard } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { runService } from "@mcp-cli/runtime";
import slack from "../src";
import { webTools } from "../src/web-methods";
import { messageUrl } from "../src/web-common";
import { expiration, searchDate } from "../src/web-datetime";
import { splitCommand } from "../src/web-argv";
import { postPolicy } from "../src/web-payload";

const C = "C0123456789",
  U = "U0123456789",
  S = "S0123456789",
  TS = "1700000000.123456";
const url = `https://test.slack.com/archives/${C}/p1700000000123456`;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const formValue = (raw: string): unknown => {
  if (/^-?\d+$/.test(raw) || raw === "true" || raw === "false") return JSON.parse(raw);
  if (!/^[[{]/.test(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
const fixture = () => {
  const seen: Array<{ method: string; input: Record<string, unknown>; auth: string | null }> = [];
  let respond = (method: string, _input: Record<string, unknown>): Record<string, unknown> => ({
    ok: true,
    channels: [{ id: C, name: "general", num_members: 12 }],
    members: [{ id: U, name: "alice", real_name: "Alice" }],
    user: { id: U },
    user_id: U,
    channel: { id: C, last_read: "1699999999.000000" },
    usergroups: [{ id: S, handle: "team" }],
    users: [U, "U9876543210"],
    messages:
      method === "search.messages"
        ? { matches: [{ ts: TS }], paging: { page: 1, pages: 2 } }
        : [{ ts: TS, text: `hello <@${U}>` }],
    file: { id: "F0123456789" },
    response_metadata: { next_cursor: "" },
  });
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const method = new URL(request.url).pathname.slice(1);
      // Real Slack ignores JSON bodies on read methods, so the fixture accepts form bodies only.
      if (request.headers.get("content-type") !== "application/x-www-form-urlencoded")
        return Response.json({
          ok: false,
          error: "invalid_arguments",
          response_metadata: { messages: ["[ERROR] missing required field: channel"] },
        });
      const input = Object.fromEntries(
        [...new URLSearchParams(await request.text())].map(([key, raw]) => [key, formValue(raw)]),
      );
      seen.push({ method, input, auth: request.headers.get("authorization") });
      return Response.json(respond(method, input));
    },
  });
  const plugin: ServicePlugin = {
    ...slack,
    connection: () => ({
      type: "http",
      url: "http://127.0.0.1:1/mcp",
      webApi: { url: `${server.url}`, tools: webTools },
    }),
  };
  const run = async (args: string[], stdin = "", guard?: RepeatGuard) => {
    const output: string[] = [];
    const code = await runService(
      plugin,
      { version: 2, service: "slack", tools: [] },
      [...args, "--json"],
      {
        open: async (credential) =>
          connect({
            type: "http",
            url: "http://127.0.0.1:1/mcp",
            headers: {
              Authorization: credential === "xoxb" ? "Bearer xoxb-fixture" : "Bearer xoxp-fixture",
            },
            webApi: { url: `${server.url}`, tools: webTools },
          }),
        guard,
        io: {
          write: (value) => output.push(value),
          writeError: (value) => output.push(value),
          readFile: (path) => readFile(path, "utf8"),
          readBytes: async (path) => new Uint8Array(await readFile(path)),
          readStdin: async () => stdin,
        },
      },
    );
    const result: unknown = JSON.parse(output.at(-1) ?? "{}");
    return { code, result: isRecord(result) ? result : {}, output };
  };
  return {
    seen,
    run,
    stop: () => server.stop(true),
    respond: (value: typeof respond) => {
      respond = value;
    },
  };
};
test("search query survives positional, structured, raw API and batch inputs", async () => {
  const f = fixture();
  const query = 'in:general "배포 완료" & + # = %';
  try {
    for (const args of [
      ["messages", "search", query],
      ["messages", "search", "--query", query],
      ["messages", "search", "--input", JSON.stringify({ query })],
      ["messages", "search", "--args", JSON.stringify([query])],
      ["messages", "search", "--input", JSON.stringify({ args: [query] })],
      ["call", "web.search.messages", "--query", query],
      ["call", "web.search.messages", "--input", JSON.stringify({ query })],
      ["batch", `messages search '${query}'`],
    ]) {
      expect((await f.run(args)).code).toBe(0);
      expect(f.seen.at(-1)).toMatchObject({ method: "search.messages", input: { query } });
    }
    expect(f.seen).toHaveLength(8);
  } finally {
    f.stop();
  }
});

test("named fields support thread reads, mixed inputs and variadic arguments", async () => {
  const f = fixture();
  try {
    for (const args of [
      ["messages", "replies", "--channel", C, "--ts", TS],
      ["messages", "replies", C, "--ts", TS],
      ["messages", "replies", "--input", JSON.stringify({ channel: C, ts: TS })],
      ["messages", "replies", "--channel", url],
    ]) {
      expect((await f.run(args)).code).toBe(0);
      expect(f.seen.at(-1)).toMatchObject({
        method: "conversations.replies",
        input: { channel: C, ts: TS },
      });
    }
    expect((await f.run(["users", "get", "--users", JSON.stringify([U])])).code).toBe(0);
    expect(f.seen.at(-1)).toMatchObject({ method: "users.info", input: { user: U } });
    const before = f.seen.length;
    await expect(f.run(["messages", "replies", C, "--channel", C, "--ts", TS])).rejects.toThrow(
      "Conflicting positional argument and option: channel",
    );
    await expect(f.run(["messages", "replies", "--ts", TS])).rejects.toThrow(
      "Missing argument: channel",
    );
    expect(f.seen).toHaveLength(before);
  } finally {
    f.stop();
  }
});

const routes: Array<[string[], string]> = [
  [["channels", "list"], "conversations.list"],
  [["channels", "me"], "users.conversations"],
  [["channels", "info", C], "conversations.info"],
  [["channels", "search", "gen"], "conversations.list"],
  [["channels", "join", C], "conversations.join"],
  [["channels", "leave", C], "conversations.leave"],
  [["users", "list"], "users.list"],
  [["users", "get", U, U], "users.info"],
  [["users", "search", "Alice"], "users.list"],
  [["users", "status", "get"], "users.profile.get"],
  [["users", "status", "set", ":wave:", "hi"], "users.profile.set"],
  [["users", "status", "clear"], "users.profile.set"],
  [["messages", "search", "hello"], "search.messages"],
  [["messages", "fetch", url], "conversations.history"],
  [["messages", "history", C], "conversations.history"],
  [["messages", "context", url], "conversations.history"],
  [["messages", "post", C, "hello"], "chat.postMessage"],
  [["messages", "post-ephemeral", C, U, "hello"], "chat.postEphemeral"],
  [["messages", "delete", url], "chat.delete"],
  [["messages", "update", url, "changed"], "chat.update"],
  [["messages", "reply", url, "hello"], "chat.postMessage"],
  [["messages", "replies", url], "conversations.replies"],
  [["messages", "unreads"], "conversations.history"],
  [["messages", "mark", C, TS], "conversations.mark"],
  [["messages", "pin", url], "pins.add"],
  [["messages", "unpin", url], "pins.remove"],
  [["messages", "pins", C], "pins.list"],
  [["reactions", "add", url, ":eyes:"], "reactions.add"],
  [["reactions", "remove", C, TS, "eyes"], "reactions.remove"],
  [["reactions", "list", url], "reactions.get"],
  [["attachment", "get", "F0123456789"], "files.info"],
  [["usergroups", "list"], "usergroups.list"],
  [["usergroups", "get", "team"], "usergroups.users.list"],
  [["usergroups", "create", "--name", "Team"], "usergroups.create"],
  [["usergroups", "update", S, "--description", "new"], "usergroups.update"],
  [["usergroups", "users", "update", S, U], "usergroups.users.update"],
  [["usergroups", "me", "list"], "usergroups.users.list"],
  [["usergroups", "me", "join", S], "usergroups.users.update"],
  [["usergroups", "me", "leave", S], "usergroups.users.update"],
  [["views", "publish", U, "--view", '{"type":"home","blocks":[]}'], "views.publish"],
  [["views", "clear", U], "views.publish"],
];
for (const [args, method] of routes)
  test(`Web API route: ${args.join(" ")}`, async () => {
    const f = fixture();
    const old = process.env.SLACK_MCP_ATTACHMENT_TOOL;
    process.env.SLACK_MCP_ATTACHMENT_TOOL = "true";
    try {
      expect((await f.run(args)).code).toBe(0);
      expect(f.seen.at(-1)?.method).toBe(method);
      expect(f.seen.at(-1)?.auth).toBe("Bearer xoxp-fixture");
      if (method === "chat.postMessage")
        expect(f.seen.at(-1)?.input).toMatchObject({ channel: C, text: "hello" });
    } finally {
      f.stop();
      if (old === undefined) delete process.env.SLACK_MCP_ATTACHMENT_TOOL;
      else process.env.SLACK_MCP_ATTACHMENT_TOOL = old;
    }
  });

test("payload dry run is reusable, exclusive, and never writes over a file", async () => {
  const f = fixture();
  const directory = await mkdtemp(join(tmpdir(), "slack-test-"));
  directories.push(directory);
  const path = join(directory, "payload.json");
  try {
    expect(
      (
        await f.run([
          "messages",
          "post",
          C,
          "**Hello**",
          "--blocks",
          "--dry-run",
          "--payload-out",
          path,
        ])
      ).code,
    ).toBe(0);
    expect(f.seen).toHaveLength(0);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      channel: C,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Hello*" } }],
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await f.run(["messages", "post", "--payload", `@${path}`])).code).toBe(0);
    await expect(
      f.run(["messages", "post", "--payload", `@${path}`, "--dry-run", "--payload-out", path]),
    ).rejects.toThrow();
    await expect(f.run(["messages", "post", C, "-", "--blocks", "-"])).rejects.toThrow();
    await expect(
      f.run([
        "messages",
        "post",
        C,
        "text",
        "--payload",
        JSON.stringify({ channel: C, text: "payload" }),
      ]),
    ).rejects.toThrow();
    await expect(f.run(["messages", "post", "--payload", '{"token":"secret"}'])).rejects.toThrow();
  } finally {
    f.stop();
  }
});

test("URL and timestamp validation preserves original digits and thread parent", () => {
  expect(messageUrl(`${url}?thread_ts=1699999999.654321`)).toEqual({
    channel: C,
    ts: TS,
    thread_ts: "1699999999.654321",
  });
  for (const value of [
    url.replace("test.slack.com", "evil.test"),
    url.replace("https:", "http:"),
    url.replace("p170", "pfoo"),
    `${url}?thread_ts=1.1`,
  ])
    expect(() => messageUrl(value)).toThrow();
});

test("calendar timezone, DST midnight and query validation", () => {
  const now = Date.parse("2025-03-09T08:00:00Z");
  expect(expiration("today", "America/New_York", now)).toBe(
    Date.parse("2025-03-10T04:00:00Z") / 1000,
  );
  expect(searchDate("1d", "Asia/Seoul", now)).toBe("2025-03-08");
  expect(() => searchDate("1d", "")).toThrow();
  expect(() => searchDate("2025-02-30", "UTC")).toThrow();
  expect(() => expiration("today", "")).toThrow();
});

test("pagination searches later pages and retains partial flags", async () => {
  const f = fixture();
  f.respond((_method, input) => ({
    ok: true,
    channels: input.cursor ? [{ id: C, name: "target" }] : [{ id: "C9876543210", name: "other" }],
    response_metadata: { next_cursor: input.cursor ? "" : "next" },
  }));
  try {
    const result = await f.run(["channels", "search", "target", "--limit", "2"]);
    expect(result.code).toBe(0);
    expect(f.seen).toHaveLength(2);
    expect(result.result.structuredContent).toMatchObject({
      items: [{ name: "target" }],
      partial: false,
    });
    expect(
      (await f.run(["channels", "list", "--limit", "1"])).result.structuredContent,
    ).toMatchObject({ partial: true, next_cursor: "next" });
  } finally {
    f.stop();
  }
});

test("Slack scope failures remain failures and users get preserves per-user results", async () => {
  const f = fixture();
  f.respond(() => ({
    ok: false,
    error: "missing_scope",
    needed: "users:read",
    provided: "chat:write",
  }));
  try {
    const result = await f.run(["users", "list"]);
    expect(result.code).toBe(1);
    expect(result.result.structuredContent).toMatchObject({
      category: "permission",
      error: "missing_scope",
      needed: "users:read",
      provided: "chat:write",
    });
    expect((await f.run(["users", "get", U])).result.structuredContent).toMatchObject({
      partial: true,
      items: [{ ok: false }],
    });
    expect((await f.run(["users", "status", "clear", "--xoxb"])).code).toBe(1);
    expect(f.seen).toHaveLength(2);
  } finally {
    f.stop();
  }
});

test("batch keeps successful entries and does not restart after failure", async () => {
  const f = fixture();
  f.respond((method) =>
    method === "conversations.leave" ? { ok: false, error: "missing_scope" } : { ok: true },
  );
  try {
    const result = await f.run([
      "batch",
      `messages post ${C} 'hello world'`,
      `channels leave ${C}`,
      `channels join ${C}`,
    ]);
    expect(result.code).toBe(1);
    expect(f.seen.map((entry) => entry.method)).toEqual([
      "chat.postMessage",
      "conversations.leave",
    ]);
    expect(result.result.structuredContent).toMatchObject({
      partial: true,
      items: [{ exitCode: 0 }, { exitCode: 1 }],
    });
    expect(splitCommand('a "b c" d\\ e')).toEqual(["a", "b c", "d e"]);
    expect(() => splitCommand('a "bad')).toThrow();
    await expect(f.run(["batch", 'batch "users list"'])).rejects.toThrow();
  } finally {
    f.stop();
  }
});

test("post policy checks both lists and rejects malformed configuration", () => {
  expect(() =>
    postPolicy(C, { SLACK_MCP_POST_CHANNEL_ALLOWLIST: C, SLACK_MCP_POST_CHANNEL_DENYLIST: C }),
  ).toThrow();
  expect(() => postPolicy(C, { SLACK_MCP_POST_CHANNEL_ALLOWLIST: "general" })).toThrow();
  expect(() => postPolicy(C, { SLACK_MCP_POST_CHANNEL_ALLOWLIST: C })).not.toThrow();
});

test("explicit user and default writes share duplicate protection", async () => {
  const f = fixture();
  const keys = new Set<string>();
  const guard: RepeatGuard = {
    begin: async (_service, key, tool, attempt) => {
      if (keys.has(key)) return { tool, attempt, status: "ok", at: Date.now() };
      keys.add(key);
      return undefined;
    },
    finish: async () => undefined,
  };
  try {
    expect((await f.run(["messages", "post", C, "one"], "", guard)).code).toBe(0);
    await expect(f.run(["messages", "post", C, "one", "--xoxp"], "", guard)).rejects.toThrow();
    expect(f.seen).toHaveLength(1);
    await expect(f.run(["users", "list", "--xoxp", "--xoxb"])).rejects.toThrow();
  } finally {
    f.stop();
  }
});

test("the eight MCP compatibility routes keep exact tool names and payloads", async () => {
  const { commands } = await import("../src/commands");
  const definitions = Object.entries(commands).map(([name]) => ({
    name,
    inputSchema: { type: "object", properties: { sentinel: { type: "string" } } },
  }));
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  for (const [name, customization] of Object.entries(commands)) {
    const code = await runService(
      slack,
      { version: 2, service: "slack", tools: definitions },
      [...customization.path, "--sentinel", "value"],
      {
        open: async () => ({
          callTool: async (tool, input) => {
            calls.push({ name: tool, input });
            return { content: [] };
          },
          listTools: async () => definitions,
          close: async () => undefined,
          listResources: async () => [],
          listResourceTemplates: async () => [],
          readResource: async () => [],
          listPrompts: async () => [],
          getPrompt: async () => ({ messages: [] }),
        }),
        io: {
          write: () => undefined,
          writeError: () => undefined,
          readStdin: async () => "",
          readFile: async () => "",
          readBytes: async () => new Uint8Array(),
        },
      },
    );
    expect(code).toBe(0);
    expect(calls.at(-1)).toEqual({ name, input: { sentinel: "value" } });
  }
  expect(calls).toHaveLength(8);
});

test("request fields preserve ts, scopes, status expiration, and replacement semantics", async () => {
  const f = fixture();
  try {
    await f.run([
      "messages",
      "history",
      C,
      "--oldest",
      TS,
      "--latest",
      "1700000001.000001",
      "--inclusive",
      "--cursor",
      "next",
      "--limit",
      "20",
    ]);
    expect(f.seen.at(-1)?.input).toEqual({
      channel: C,
      oldest: TS,
      latest: "1700000001.000001",
      inclusive: true,
      cursor: "next",
      limit: 20,
    });
    await f.run(["messages", "reply", `${url}?thread_ts=1699999999.000001`, "reply"]);
    expect(f.seen.at(-1)?.input).toEqual({
      channel: C,
      text: "reply",
      thread_ts: "1699999999.000001",
    });
    await f.run(["reactions", "add", C, TS, ":eyes:"]);
    expect(f.seen.at(-1)?.input).toEqual({ channel: C, timestamp: TS, name: "eyes" });
    await f.run(["users", "status", "clear"]);
    expect(f.seen.at(-1)?.input).toEqual({
      profile: { status_text: "", status_emoji: "", status_expiration: 0 },
    });
    await f.run(["usergroups", "users", "update", S, U, U]);
    expect(f.seen.at(-1)?.input).toEqual({ usergroup: S, users: U });
    await f.run([
      "messages",
      "search",
      "hello",
      "--channel",
      'general" OR secret',
      "--during",
      "october",
      "--threads",
      "--page",
      "2",
    ]);
    expect(f.seen.at(-1)?.input).toEqual({
      query: 'hello in:"general\\" OR secret" during:"october" is:thread',
      count: 100,
      page: 2,
    });
  } finally {
    f.stop();
  }
});

test("missing target, incomplete channel names, unsupported muted filtering and invalid views reject safely", async () => {
  const f = fixture();
  try {
    await expect(f.run(["messages", "unreads", "--include-muted"])).rejects.toThrow();
    expect(f.seen).toHaveLength(0);
    await expect(
      f.run(["views", "publish", U, "--view", '{"type":"modal","blocks":[]}']),
    ).rejects.toThrow();
    await expect(f.run(["messages", "post", C, "-", "--input", "-"])).rejects.toThrow();
    f.respond(() => ({ ok: true, messages: [{ ts: "1700000000.123455" }] }));
    await expect(f.run(["messages", "fetch", url])).rejects.toThrow();
    f.respond(() => ({
      ok: true,
      channels: [
        { id: C, name: "same" },
        { id: "C9876543210", name: "same" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    await expect(f.run(["channels", "join", "same"])).rejects.toThrow();
  } finally {
    f.stop();
  }
});

test("help and schema cover every business command without a connection", async () => {
  const { specs } = await import("../src/web-specs");
  let opens = 0;
  for (const entry of specs) {
    const output: string[] = [];
    const ports = {
      open: async (): Promise<never> => {
        opens++;
        throw new Error("Must not connect");
      },
      io: {
        write: (value: string) => output.push(value),
        writeError: (value: string) => output.push(value),
        readStdin: async () => "",
        readFile: async () => "",
        readBytes: async () => new Uint8Array(),
      },
    };
    expect(
      await runService(
        slack,
        { version: 2, service: "slack", tools: [] },
        [...entry.path.split(" "), "--help"],
        ports,
      ),
    ).toBe(0);
    expect(output.join("\n")).toContain(entry.method);
    for (const field of entry.args)
      expect(output.join("\n")).toContain(`--${field.replace(/\?|\.\.\./g, "")}`);
    expect(
      await runService(
        slack,
        { version: 2, service: "slack", tools: [] },
        ["schema", ...entry.path.split(" ")],
        ports,
      ),
    ).toBe(0);
  }
  expect(opens).toBe(0);
});

test("Markdown converts Slack differences while preserving code spans", async () => {
  const { markdown } = await import("../src/web-payload");
  expect(markdown("**bold** *italic* ~~gone~~ [docs](https://example.test) `**literal**`")).toBe(
    "*bold* _italic_ ~gone~ <https://example.test|docs> `**literal**`",
  );
  expect(markdown("# Heading\n> quote & <tag>")).toBe("*Heading*\n> quote &amp; &lt;tag&gt;");
});

test("read commands deliver channel and ts to the Web API from every input form", async () => {
  const f = fixture();
  const replies = { method: "conversations.replies", input: { channel: C, ts: TS } };
  try {
    for (const args of [
      ["messages", "replies", C, TS, "--limit=20"],
      ["messages", "replies", "--input", JSON.stringify({ channel: C, ts: TS, limit: 15 })],
      [
        "call",
        "web.conversations.replies",
        "--input",
        JSON.stringify({ channel: C, ts: TS, limit: 15 }),
      ],
    ]) {
      expect((await f.run(args)).code).toBe(0);
      expect(f.seen.at(-1)).toMatchObject(replies);
    }
    expect((await f.run(["messages", "fetch", url])).code).toBe(0);
    expect(f.seen.at(-1)).toMatchObject({
      method: "conversations.history",
      input: { channel: C, latest: TS },
    });
  } finally {
    f.stop();
  }
});

test("post-ephemeral accepts payload, blocks and dry-run like post", async () => {
  const f = fixture();
  const blocks = [
    {
      type: "plan",
      title: "Release plan",
      tasks: [{ type: "task_card", task_id: "t1", title: "Run checks", status: "complete" }],
    },
  ];
  const payload = { channel: C, user: U, blocks, thread_ts: TS };
  try {
    const dry = await f.run([
      "messages",
      "post-ephemeral",
      "--xoxp",
      "--dry-run",
      `--payload=${JSON.stringify(payload)}`,
    ]);
    expect(dry.code).toBe(0);
    expect(f.seen).toHaveLength(0);
    expect(dry.result.structuredContent).toMatchObject({
      dry_run: true,
      method: "chat.postEphemeral",
      ephemeral: true,
      payload: { ...payload, text: "Release plan\nRun checks" },
    });
    expect(
      (await f.run(["messages", "post-ephemeral", "--payload", JSON.stringify(payload)])).code,
    ).toBe(0);
    expect(f.seen.at(-1)).toMatchObject({ method: "chat.postEphemeral", input: payload });
    expect((await f.run(["messages", "post-ephemeral", C, U, "**Hi**", "--blocks"])).code).toBe(0);
    expect(f.seen.at(-1)?.input).toMatchObject({
      user: U,
      text: "**Hi**",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Hi*" } }],
    });
    expect(
      (await f.run(["messages", "post-ephemeral", "--input", JSON.stringify({ payload })])).code,
    ).toBe(0);
    await expect(
      f.run(["messages", "post-ephemeral", "--payload", JSON.stringify({ ...payload, as: 1 })]),
    ).rejects.toThrow("Unsupported payload field: as");
    await expect(
      f.run(["messages", "post-ephemeral", "--payload", JSON.stringify({ channel: C, text: "x" })]),
    ).rejects.toThrow();
  } finally {
    f.stop();
  }
});

test("blocks-only messages derive fallback text from rich_text and markdown blocks", async () => {
  const f = fixture();
  const rich = [
    {
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "rich body" }] }],
    },
  ];
  const md = [{ type: "markdown", text: "**md body**" }];
  try {
    for (const [blocks, text] of [
      [rich, "rich body"],
      [md, "**md body**"],
    ] as const) {
      const result = await f.run([
        "messages",
        "post",
        "--input",
        JSON.stringify({ channel: C, blocks, "dry-run": true }),
      ]);
      expect(result.result.structuredContent).toMatchObject({ payload: { blocks, text } });
    }
  } finally {
    f.stop();
  }
});
