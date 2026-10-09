import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store";
import type { Scope, Store } from "../src/types";
import { bytes } from "../src/values";
import { zoom } from "../src/zoom";

const scope: Scope = { id: "project:test", name: "test", kind: "project" };
const resources: { store: Store; directory: string }[] = [];
const setup = (count = 8, text = "original") => {
  const directory = mkdtempSync(join(tmpdir(), "mem-zoom-"));
  const store = openStore(join(directory, "memory.sqlite"));
  resources.push({ store, directory });
  store.scope(scope);
  for (let i = 0; i < count; i++) store.append(scope.id, "user", text, `receipt-${i}`);
  return store;
};
afterEach(() => {
  for (const { store, directory } of resources.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
const request = (count = 8) => ({
  recordId: `${scope.id}/0`,
  count,
  generation: "usergen",
  maxBytes: 512,
});
const publish = (store: Store, generation: string, l: number, i: number, text = `${l}:${i}`) => {
  store.claim(scope.id, generation, "test-owner");
  try {
    store.publish(
      scope.id,
      generation,
      "test-owner",
      { l, i, text },
      {
        text,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      },
    );
  } finally {
    store.release(scope.id, generation, "test-owner");
  }
};
const fails = (action: () => unknown, code: string) => {
  try {
    action();
    throw new Error("Expected structured error");
  } catch (error) {
    expect(error).toHaveProperty("code", code);
  }
};

test("deep division reads exact children without requiring a parent or generating nodes", () => {
  const store = setup();
  for (let l = 0; l < 3; l++) for (let i = 0; i < 8 / 2 ** l; i++) publish(store, "usergen", l, i);
  const before = store.nodes(scope.id, "usergen");
  for (const count of [8, 4, 2]) {
    for (let start = 0; start < 8; start += count) {
      const result = zoom(store, [scope], { ...request(count), recordId: `${scope.id}/${start}` });
      expect(result).toEqual({
        ok: true,
        generation: "usergen",
        children: [start, start + count / 2].map((i) => ({
          recordId: `${scope.id}/${i}`,
          count: count / 2,
          summary: `${Math.log2(count / 2)}:${i / (count / 2)}`,
        })),
      });
    }
  }
  expect(store.nodes(scope.id, "usergen")).toEqual(before);
  expect(store.usage().calls).toBe(0);
});

test("missing child does not fall back to a different generation", () => {
  const store = setup(2);
  publish(store, "usergen", 0, 0);
  publish(store, "newgen", 0, 1);
  fails(() => zoom(store, [scope], request(2)), "NODE_UNAVAILABLE");
});

test("selected scopes, ranges, alignment and safe integer boundaries are checked", () => {
  const store = setup();
  fails(() => zoom(store, [], request()), "RECORD_UNAVAILABLE");
  for (const count of [0, -1, 3, 1.5, NaN, Infinity, 2 ** 52 - 1, Number.MAX_SAFE_INTEGER, 2 ** 53])
    fails(() => zoom(store, [scope], { ...request(), count }), "INVALID_OPTION");
  for (const index of ["-1", "1.5", "9007199254740992", ""])
    fails(
      () => zoom(store, [scope], { ...request(1), recordId: `${scope.id}/${index}` }),
      "INVALID_OPTION",
    );
  for (const [index, count] of [
    [1, 2],
    [Number.MAX_SAFE_INTEGER, 1],
    [2 ** 52, 2 ** 52],
  ])
    fails(
      () => zoom(store, [scope], { ...request(count), recordId: `${scope.id}/${index}` }),
      "INVALID_OPTION",
    );
  fails(() => zoom(store, [scope], request(16)), "RECORD_UNAVAILABLE");
  fails(() => zoom(store, [scope], { ...request(), cursor: "0" }), "INVALID_OPTION");
});

test("generation accepts immutable API identifiers and rejects unbounded or non-ASCII values", () => {
  const store = setup(1);
  for (const generation of ["usergen", "a".repeat(24), "A_1.test-old", "a".repeat(128)])
    expect(zoom(store, [scope], { ...request(1), generation })).toHaveProperty(
      "generation",
      generation,
    );
  for (const generation of ["", "a".repeat(129), "한글", "a/b", "a\n"])
    fails(() => zoom(store, [scope], { ...request(1), generation }), "INVALID_OPTION");
});

test("single record pages reserve generation metadata within the complete escaped UTF-8 budget", () => {
  const original = '한😀"\\\n\t'.repeat(200);
  const store = setup(1, original);
  let cursor: string | undefined;
  let reconstructed = "";
  let pages = 0;
  do {
    const result = zoom(store, [scope], {
      ...request(1),
      generation: "g".repeat(128),
      ...(cursor === undefined ? {} : { cursor }),
    }) as { text: string; cursor: string | null; generation: string };
    expect(bytes(`${JSON.stringify(result)}\n`)).toBeLessThanOrEqual(512);
    expect(result.generation).toBe("g".repeat(128));
    reconstructed += result.text;
    cursor = result.cursor ?? undefined;
    pages++;
  } while (cursor !== undefined && pages < 100);
  expect(pages).toBeGreaterThan(1);
  expect(reconstructed).toBe(original);
  fails(() => zoom(store, [scope], { ...request(1), maxBytes: 1 }), "OUTPUT_OVERFLOW");
  fails(() => zoom(store, [scope], { ...request(1), cursor: "999999" }), "INVALID_OPTION");
});

test("summary responses enforce the full UTF-8 JSON budget without truncation", () => {
  const store = setup(2);
  for (let i = 0; i < 2; i++) publish(store, "usergen", 0, i, '한😀"\\'.repeat(30));
  const result = zoom(store, [scope], { ...request(2), maxBytes: 20480 });
  const size = bytes(`${JSON.stringify(result)}\n`);
  expect(zoom(store, [scope], { ...request(2), maxBytes: size })).toEqual(result);
  fails(() => zoom(store, [scope], { ...request(2), maxBytes: size - 1 }), "OUTPUT_OVERFLOW");
});

test("old generation remains accessible after new settings and later appends", () => {
  const store = setup(2);
  for (let i = 0; i < 2; i++) publish(store, "usergen", 0, i, `old ${i}`);
  const before = zoom(store, [scope], request(2));
  for (let i = 0; i < 2; i++) publish(store, "newgen", 0, i, `new ${i}`);
  store.append(scope.id, "note", "later", "later");
  expect(zoom(store, [scope], request(2))).toEqual(before);
  expect(zoom(store, [scope], { ...request(2), generation: "newgen" })).not.toEqual(before);
});
