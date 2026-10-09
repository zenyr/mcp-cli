import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generationFor, openStore } from "../src/store";
import type { Settings, Store } from "../src/types";

const directories: string[] = [];
const stores: Store[] = [];
const usage = { text: "summary", model: "test", inputTokens: 7, outputTokens: 3, usageKnown: true };
const scope = { id: "global", name: "global", kind: "global" } as const;
const settings: Settings = {
  model: "test",
  baseUrl: "http://localhost/v1",
  nodeBytes: 512,
  contextBytes: 1024,
  inputBytes: 4096,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mem-store-"));
  directories.push(directory);
  const path = join(directory, "memory.sqlite");
  const store = openStore(path);
  stores.push(store);
  store.scope(scope);
  return { store, path };
};
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("receipts are idempotent per scope and reject text or kind collisions", async () => {
  const { store } = await fixture();
  const first = store.append("global", "user", "one", "receipt");
  expect(store.append("global", "user", "one", "receipt")).toEqual(first);
  expect(() => store.append("global", "user", "two", "receipt")).toThrow(
    expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
  );
  expect(() => store.append("global", "note", "one", "receipt")).toThrow(
    expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
  );
  expect(store.append("project", "user", "two", "receipt").i).toBe(0);
  expect(store.entries("global")).toEqual([first]);
  expect(store.entries("global", 0)).toEqual([]);
});

test("nodes survive reopening and cannot replace an immutable publication", async () => {
  const { store, path } = await fixture();
  store.append("global", "user", "original", "r");
  store.claim("global", "g", "owner");
  store.publish("global", "g", "owner", { l: 0, i: 0, text: "first" }, usage);
  expect(() =>
    store.publish("global", "g", "owner", { l: 0, i: 0, text: "changed" }, usage),
  ).toThrow();
  const reopened = openStore(path);
  stores.push(reopened);
  expect(reopened.nodes("global", "g")).toEqual([{ l: 0, i: 0, text: "first" }]);
  expect(reopened.nodes("project", "g")).toEqual([]);
  expect(reopened.nodes("global", "other")).toEqual([]);
  expect(reopened.entries("global")[0]?.text).toBe("original");
});

test("leases isolate generations, reject competing owners, and recover after release", async () => {
  const { store, path } = await fixture();
  const second = openStore(path);
  stores.push(second);
  store.append("global", "user", "original", "r");
  store.claim("global", "g", "a");
  expect(() => second.claim("global", "g", "b")).toThrow(
    expect.objectContaining({ code: "MEMORY_BUSY" }),
  );
  second.claim("global", "other", "b");
  second.release("global", "g", "b");
  expect(() => second.publish("global", "g", "b", { l: 0, i: 0, text: "bad" }, usage)).toThrow(
    expect.objectContaining({ code: "LEASE_LOST" }),
  );
  store.failed("global", "g", "a", "failure");
  second.failed("global", "g", "b", "overwrite");
  expect(store.status([scope], "g")[0]?.lastError).toBe("failure");
  store.release("global", "g", "a");
  expect(() => store.publish("global", "g", "a", { l: 0, i: 0, text: "stale" }, usage)).toThrow(
    expect.objectContaining({ code: "LEASE_LOST" }),
  );
  second.claim("global", "g", "b");
  second.publish("global", "g", "b", { l: 0, i: 0, text: "recovered" }, usage);
  expect(store.status([scope], "g")[0]).toMatchObject({ pending: 0, lastError: null });
});

test("expired leases recover without waiting and missing children prevent parent publication", async () => {
  const { store, path } = await fixture();
  store.append("global", "user", "one", "1");
  store.append("global", "user", "two", "2");
  store.claim("global", "g", "old");
  const db = new Database(path);
  try {
    db.query("UPDATE leases SET expires=0").run();
  } finally {
    db.close();
  }
  store.claim("global", "g", "new");
  expect(() => store.renew("global", "g", "old")).toThrow(
    expect.objectContaining({ code: "LEASE_LOST" }),
  );
  store.renew("global", "g", "new");
  expect(() => store.publish("global", "g", "old", { l: 0, i: 0, text: "stale" }, usage)).toThrow(
    expect.objectContaining({ code: "LEASE_LOST" }),
  );
  expect(() => store.publish("global", "g", "new", { l: 1, i: 0, text: "parent" }, usage)).toThrow(
    expect.objectContaining({ code: "NODE_UNAVAILABLE" }),
  );
  for (const i of [0, 1])
    store.publish("global", "g", "new", { l: 0, i, text: `leaf ${i}` }, usage);
  store.publish("global", "g", "new", { l: 1, i: 0, text: "parent" }, usage);
  expect(store.nodes("global", "g")).toHaveLength(3);
  expect(() => store.publish("global", "g", "new", { l: 0, i: 2, text: "outside" }, usage)).toThrow(
    expect.objectContaining({ code: "INVALID_NODE" }),
  );
});

test("usage records every reply separately from publication and persists unknown usage", async () => {
  const { store, path } = await fixture();
  store.recordUsage("global", "g", usage);
  store.recordUsage("global", "g", {
    ...usage,
    inputTokens: 0,
    outputTokens: 0,
    usageKnown: false,
  });
  store.recordUsage("global", "g", { ...usage, model: "verbatim" });
  const reopened = openStore(path);
  stores.push(reopened);
  expect(reopened.usage()).toEqual({
    calls: 2,
    inputTokens: 7,
    outputTokens: 3,
    unmeasuredCalls: 1,
  });
});

test("generation changes for semantic settings but remains stable for timeout", () => {
  const original = generationFor(settings);
  expect(generationFor({ ...settings, timeoutMs: 50 })).toBe(original);
  expect(generationFor({ ...settings, maxOutputTokens: 4096 })).toBe(original);
  for (const change of [
    { model: "other" },
    { baseUrl: "http://other/v1" },
    { nodeBytes: 513 },
    { contextBytes: 1025 },
    { inputBytes: 4097 },
  ]) {
    expect(generationFor({ ...settings, ...change })).not.toBe(original);
  }
});

test("reopening rejects unsupported schemas and reading detects a log gap", async () => {
  const { store, path } = await fixture();
  store.append("global", "user", "one", "1");
  store.append("global", "user", "two", "2");
  const db = new Database(path);
  try {
    db.query("DELETE FROM entries WHERE scope=? AND i=0").run("global");
    expect(() => store.entries("global")).toThrow(expect.objectContaining({ code: "LOG_CORRUPT" }));
    db.exec("PRAGMA user_version=99");
    expect(() => openStore(path)).toThrow(expect.objectContaining({ code: "SCHEMA_VERSION" }));
  } finally {
    db.close();
  }
});
