import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store";
import { createPinStore } from "../src/pins-store";
import type { PinChange, Store } from "../src/types";

const directories: string[] = [];
const close: (() => void)[] = [];
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mem-pins-"));
  directories.push(directory);
  const path = join(directory, "memory.sqlite");
  const store = openStore(path);
  close.push(store.close);
  const db = new Database(path);
  close.push(() => db.close());
  const pins = createPinStore(db);
  store.append("global", "user", "A😀e\u0301한Z", "original");
  const change: PinChange = {
    scope: "global",
    key: "focus",
    expectedRevision: 0,
    receipt: randomUUID(),
    op: "pin",
    i: 0,
    from: 1,
    to: 4,
  };
  return { path, store, db, pins, change };
};
const reopen = (path: string): Store => {
  const store = openStore(path);
  close.push(store.close);
  return store;
};
afterEach(async () => {
  for (const dispose of close.splice(0).reverse()) dispose();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("pins preserve Unicode scalars, original kind and SQL latest state", async () => {
  const { pins, change } = await fixture();
  const first = pins.changePin(change);
  expect(first).toMatchObject({ active: true, revision: 1, kind: "user", text: "😀e\u0301" });
  const released = pins.changePin({
    scope: "global",
    key: "focus",
    expectedRevision: 1,
    receipt: randomUUID(),
    op: "unpin",
  });
  expect(released).toMatchObject({ active: false, revision: 2, source: first.source });
  expect(pins.pins("global")).toEqual([released]);
  const replaced = pins.changePin({
    ...change,
    expectedRevision: 2,
    receipt: randomUUID(),
    from: 4,
    to: 5,
  });
  expect(replaced).toMatchObject({ active: true, revision: 3, text: "한" });
  expect(pins.pins("global")).toEqual([replaced]);
});

test("reopening replays recorded results after later changes and detects receipt collisions", async () => {
  const { pins, change, path } = await fixture();
  const first = pins.changePin(change);
  const release: PinChange = {
    scope: change.scope,
    key: change.key,
    expectedRevision: 1,
    receipt: randomUUID(),
    op: "unpin",
  };
  const released = pins.changePin(release);
  pins.changePin({ ...change, expectedRevision: 2, receipt: randomUUID(), from: 0, to: 1 });
  const second = reopen(path);
  expect(second.changePin(change)).toEqual(first);
  expect(second.changePin(release)).toEqual(released);
  expect(() => second.changePin({ ...change, key: "other" })).toThrow(
    expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
  );
  expect(() => second.changePin({ ...change, expectedRevision: 3 })).toThrow(
    expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
  );
});

test("two database connections serialize CAS and isolate scopes", async () => {
  const { pins, change, path, store } = await fixture();
  const second = reopen(path);
  pins.changePin(change);
  expect(() => second.changePin({ ...change, receipt: randomUUID() })).toThrow(
    expect.objectContaining({ code: "REVISION_CONFLICT" }),
  );
  store.append("project", "tool", "project", "original");
  expect(second.changePin({ ...change, scope: "project", from: 0, to: 7 })).toMatchObject({
    revision: 1,
    kind: "tool",
    text: "project",
  });
  expect(pins.pins("global")).toHaveLength(1);
  expect(pins.pins("project")).toHaveLength(1);
});

test("orphan pins remain listable and unpin does not require the source", async () => {
  const { pins, change, db } = await fixture();
  const first = pins.changePin(change);
  db.query("DELETE FROM entries WHERE scope=?").run("global");
  expect(pins.pins("global")[0]).toMatchObject({ active: true, text: undefined });
  expect(pins.changePin(change)).toEqual(first);
  expect(
    pins.changePin({
      scope: "global",
      key: "focus",
      expectedRevision: 1,
      receipt: randomUUID(),
      op: "unpin",
    }),
  ).toMatchObject({ active: false, revision: 2 });
});

test("eight active pins allow replacement and release but reject a ninth without events", async () => {
  const { pins, change, db } = await fixture();
  for (let index = 0; index < 8; index++)
    pins.changePin({ ...change, key: `p${index}`, receipt: randomUUID() });
  expect(() => pins.changePin({ ...change, key: "ninth", receipt: randomUUID() })).toThrow(
    expect.objectContaining({ code: "PIN_OVERFLOW" }),
  );
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM pin_events").get()?.count,
  ).toBe(8);
  pins.changePin({ ...change, key: "p0", expectedRevision: 1, receipt: randomUUID() });
  pins.changePin({
    scope: "global",
    key: "p1",
    expectedRevision: 1,
    receipt: randomUUID(),
    op: "unpin",
  });
  pins.changePin({ ...change, key: "ninth", receipt: randomUUID() });
  expect(pins.pins("global").filter((pin) => pin.active)).toHaveLength(8);
});

test("invalid changes never append events and CAS precedes source validation", async () => {
  const { pins, change, db, store } = await fixture();
  store.append("global", "note", "", "empty");
  const invalid: PinChange[] = [
    { ...change, key: "" },
    { ...change, key: "가" },
    { ...change, key: "a".repeat(65) },
    { ...change, receipt: "" },
    { ...change, receipt: "not-a-uuid" },
    { ...change, expectedRevision: -1 },
    { ...change, i: -1 },
    { ...change, i: 0.5 },
    { ...change, from: -1 },
    { ...change, to: 1 },
    { ...change, to: 99 },
    { ...change, from: 1.5 },
    { ...change, to: Number.MAX_SAFE_INTEGER + 1 },
    { ...change, i: 1, from: 0, to: 1 },
    { ...change, i: 99 },
    { scope: "global", key: "missing", expectedRevision: 0, receipt: randomUUID(), op: "unpin" },
  ];
  for (const input of invalid) expect(() => pins.changePin(input)).toThrow();
  expect(() => pins.changePin({ ...change, expectedRevision: 1, i: 99 })).toThrow(
    expect.objectContaining({ code: "REVISION_CONFLICT" }),
  );
  expect(
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM pin_events").get()?.count,
  ).toBe(0);
});

test("factory is idempotent inside a parent transaction and leaves schema version unchanged", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE entries(scope TEXT,i INTEGER,kind TEXT,text TEXT); PRAGMA user_version=1",
    );
    db.transaction(() => {
      createPinStore(db);
      createPinStore(db);
    }).immediate();
    expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(
      1,
    );
  } finally {
    db.close();
  }
});
