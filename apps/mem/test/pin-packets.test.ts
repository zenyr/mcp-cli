import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main";
import { startPacket } from "../src/packets";
import { openStore } from "../src/store";
import { summarize } from "../src/tree";
import { Database } from "bun:sqlite";
import type { Scope, Settings } from "../src/types";

const directories: string[] = [];
const temporary = () => {
  const path = mkdtempSync(join(tmpdir(), "mem-pin-packet-"));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const settings: Settings = {
  model: "fixture",
  baseUrl: "http://unused",
  nodeBytes: 512,
  contextBytes: 8192,
  inputBytes: 131072,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};

test("CLI zoom and pin changes reuse originals without invoking the model", async () => {
  const directory = temporary();
  let stdout = "";
  let calls = 0;
  const run = async (args: string[]) => {
    stdout = "";
    const code = await main([...args, "--json"], {
      cwd: directory,
      env: { HOME: directory },
      compress: async () => {
        calls++;
        return { text: "summary", model: "fixture", inputTokens: 1, outputTokens: 1 };
      },
      io: {
        write: (text) => {
          stdout += text;
        },
        readFile: async () => "",
        readStdin: async () => "",
      },
    });
    return { code, text: stdout };
  };
  await run(["save", "Deploy staging only", "--global", "--kind", "user"]);
  await run(["save", "Deployment is not confirmed", "--global"]);
  const baseline = calls;
  const start = await run(["start", "--global"]);
  const match = /"generation":"([a-f0-9]+)"/.exec(start.text);
  if (!match?.[1]) throw new Error("Missing generation");
  expect(
    (await run(["zoom", "global/0", "--count", "2", "--generation", match[1], "--global"])).text,
  ).toContain("children");
  const receipt = "550e8400-e29b-41d4-a716-446655440000";
  const pin = [
    "pin",
    "global/0",
    "--global",
    "--key",
    "target",
    "--from",
    "7",
    "--to",
    "14",
    "--expected-revision",
    "0",
    "--receipt",
    receipt,
  ];
  expect((await run(pin)).code).toBe(0);
  expect((await run(pin)).text).toContain('"revision":1');
  expect((await run(["start", "--global"])).text).toContain('"text":"staging"');
  expect((await run(["pins", "--global", "--key", "target"])).text).toContain('"kind":"user"');
  expect(
    (
      await run([
        "unpin",
        "target",
        "--global",
        "--expected-revision",
        "1",
        "--receipt",
        "550e8400-e29b-41d4-a716-446655440001",
      ])
    ).code,
  ).toBe(0);
  expect((await run(["pins", "--global"])).text).toContain('"active":false');
  expect((await run(["start", "--global"])).text).not.toContain('"pins":');
  expect(calls).toBe(baseline);
});

test("global and project pins share the byte cap and are never silently omitted", async () => {
  const directory = temporary();
  const store = openStore(join(directory, "memory.sqlite"));
  const scopes: Scope[] = [
    { id: "global", name: "global", kind: "global" },
    { id: "project", name: "project", kind: "project" },
  ];
  try {
    for (const [index, scope] of scopes.entries()) {
      store.scope(scope);
      store.append(scope.id, "user", "x".repeat(1500), "source");
      await summarize(store, scope, "g", settings, async () => ({
        text: "summary",
        model: "fixture",
        inputTokens: 1,
        outputTokens: 1,
      }));
      store.changePin({
        scope: scope.id,
        key: "important",
        expectedRevision: 0,
        receipt: `550e8400-e29b-41d4-a716-44665544000${index}`,
        op: "pin",
        i: 0,
        from: 0,
        to: 1500,
      });
    }
    expect(() => startPacket(store, scopes, "g", 8192)).toThrow(
      expect.objectContaining({ code: "PIN_OVERFLOW" }),
    );
    expect(store.pins("global")[0]?.active).toBe(true);
    expect(store.pins("project")[0]?.active).toBe(true);
    const one = startPacket(store, scopes.slice(0, 1), "g", 8192);
    expect(JSON.stringify(one)).toContain('"text":"' + "x".repeat(1500) + '"');
    expect(() => startPacket(store, scopes.slice(0, 1), "g", 512)).toThrow(
      expect.objectContaining({ code: "MEMORY_OVERFLOW" }),
    );
  } finally {
    store.close();
  }
});

test("active pins with missing originals block startup but remain releasable", async () => {
  const store = openStore(join(temporary(), "memory.sqlite"));
  const scope: Scope = { id: "global", name: "global", kind: "global" };
  try {
    store.scope(scope);
    store.append(scope.id, "user", "staging", "source");
    store.changePin({
      scope: scope.id,
      key: "target",
      expectedRevision: 0,
      receipt: "550e8400-e29b-41d4-a716-446655440000",
      op: "pin",
      i: 0,
      from: 0,
      to: 7,
    });
    const path = directories.at(-1);
    if (!path) throw new Error("Missing fixture");
    const db = new Database(join(path, "memory.sqlite"));
    db.exec("DELETE FROM entries");
    db.close();
    expect(() => startPacket(store, [scope], "g", 8192)).toThrow(
      expect.objectContaining({ code: "SOURCE_UNAVAILABLE" }),
    );
    expect(
      store.changePin({
        scope: scope.id,
        key: "target",
        expectedRevision: 1,
        receipt: "550e8400-e29b-41d4-a716-446655440001",
        op: "unpin",
      }).active,
    ).toBe(false);
  } finally {
    store.close();
  }
});

test("maximum project and key identifiers fit 512-byte mutation acknowledgements", async () => {
  const directory = temporary();
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
    const [code] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
  };
  await git(["init"]);
  await git(["config", "mem.project-id", "x".repeat(128)]);
  let stdout = "";
  const run = async (args: string[]) => {
    stdout = "";
    const code = await main([...args, "--json"], {
      cwd: directory,
      env: { HOME: directory },
      io: {
        write: (text) => {
          stdout += text;
        },
        readFile: async () => "",
        readStdin: async () => "",
      },
    });
    expect(code).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(512);
  };
  await run(["save", "Q", "--kind", "user", "--max-bytes", "512"]);
  await run([
    "pin",
    `project-${"x".repeat(128)}/0`,
    "--key",
    "k".repeat(64),
    "--from",
    "0",
    "--to",
    "1",
    "--expected-revision",
    "0",
    "--receipt",
    "550e8400-e29b-41d4-a716-446655440000",
    "--max-bytes",
    "512",
  ]);
  await run([
    "unpin",
    "k".repeat(64),
    "--expected-revision",
    "1",
    "--receipt",
    "550e8400-e29b-41d4-a716-446655440001",
    "--max-bytes",
    "512",
  ]);
});

test("oversized pins remain discoverable and releasable through small metadata responses", async () => {
  const directory = temporary();
  let stdout = "";
  const run = async (args: string[]) => {
    stdout = "";
    const code = await main([...args, "--json"], {
      cwd: directory,
      env: { HOME: directory },
      compress: async () => ({
        text: "summary",
        model: "fixture",
        inputTokens: 1,
        outputTokens: 1,
      }),
      io: {
        write: (text) => {
          stdout += text;
        },
        readFile: async () => "",
        readStdin: async () => "x".repeat(12000),
      },
    });
    expect(code).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeLessThanOrEqual(512);
  };
  await run(["save", "--global", "--stdin", "--max-bytes", "512"]);
  await run([
    "pin",
    "global/0",
    "--global",
    "--key",
    "large",
    "--from",
    "0",
    "--to",
    "12000",
    "--expected-revision",
    "0",
    "--receipt",
    "550e8400-e29b-41d4-a716-446655440000",
    "--max-bytes",
    "512",
  ]);
  await run(["pins", "--global", "--key", "large", "--max-bytes", "512"]);
  expect(stdout).toContain('"revision":1');
  expect(stdout).not.toContain('"text":');
  await run([
    "unpin",
    "large",
    "--global",
    "--expected-revision",
    "1",
    "--receipt",
    "550e8400-e29b-41d4-a716-446655440001",
    "--max-bytes",
    "512",
  ]);
});
