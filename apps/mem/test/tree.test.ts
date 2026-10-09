import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPacket } from "../src/packets";
import { openStore } from "../src/store";
import { summarize } from "../src/tree";
import type { Compressor, Scope, Settings, Store } from "../src/types";
import { bytes } from "../src/values";

const settings: Settings = {
  model: "test",
  baseUrl: "http://unused",
  nodeBytes: 64,
  contextBytes: 600,
  inputBytes: 10000,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};
const scope: Scope = { id: "project:test", name: "test", kind: "project" };
const generation = "test-generation";
const resources: { directory: string; store: Store }[] = [];
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "mem-tree-"));
  const path = join(directory, "memory.sqlite");
  const store = openStore(path);
  store.scope(scope);
  resources.push({ directory, store });
  return { store, path };
};
afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.store.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});
const append = (store: Store, count: number, text = "x".repeat(100)) => {
  for (let i = 0; i < count; i += 1)
    store.append(scope.id, "user", `${i}: ${text}`, `receipt-${i}`);
};
const compact: Compressor = async () => ({
  text: "remembered fact",
  inputTokens: 10,
  outputTokens: 3,
  model: "test",
});
type Packet = {
  scopes: { messages: number; view: { id: string; count: number; summary: string }[] }[];
};
const packetShape = (value: unknown): Packet => {
  expect(value).toBeObject();
  return value as Packet;
};

test("48 and odd message counts build every complete binary node and cover budgeted packets", async () => {
  for (const count of [1, 3, 7, 17, 48]) {
    const { store } = setup();
    append(store, count);
    await summarize(store, scope, generation, settings, compact);
    let expected = 0;
    for (let width = 1; width <= count; width *= 2) expected += Math.floor(count / width);
    expect(store.nodes(scope.id, generation)).toHaveLength(expected);
    const packet = startPacket(store, [scope], generation, 650);
    expect(bytes(`${JSON.stringify(packet)}\n`)).toBeLessThanOrEqual(650);
    const selected = packetShape(packet).scopes[0];
    expect(selected?.messages).toBe(count);
    let cursor = 0;
    for (const item of selected?.view ?? []) {
      expect(item.id).toBe(`${scope.id}/${cursor}`);
      cursor += item.count;
    }
    expect(cursor).toBe(count);
  }
});

test("restart reuses immutable nodes and append builds only missing nodes", async () => {
  const { store, path } = setup();
  append(store, 3);
  await summarize(store, scope, generation, settings, compact);
  const before = store.nodes(scope.id, generation);
  const reopened = openStore(path);
  try {
    await summarize(reopened, scope, generation, settings, async () => {
      throw new Error("unexpected compression");
    });
    expect(reopened.nodes(scope.id, generation)).toEqual(before);
    reopened.append(scope.id, "note", "new fact", "new-receipt");
    await summarize(reopened, scope, generation, settings, compact);
    expect(reopened.nodes(scope.id, generation)).toHaveLength(7);
    for (const node of before) expect(reopened.nodes(scope.id, generation)).toContainEqual(node);
  } finally {
    reopened.close();
  }
});

test("failed summary retains raw messages and recovers with a released lease", async () => {
  const { store } = setup();
  append(store, 2);
  await expect(
    summarize(store, scope, generation, settings, async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  expect(store.status([scope], generation)[0]?.lastError).toBe("offline");
  expect(() => startPacket(store, [scope], generation, 8192)).toThrow("mem summarize");
  expect(store.entries(scope.id)[0]?.text).toBe(`0: ${"x".repeat(100)}`);
  await summarize(store, scope, generation, settings, compact);
  expect(store.status([scope], generation)[0]?.pending).toBe(0);
  expect(store.status([scope], generation)[0]?.lastError).toBeNull();
});

test("three oversized replies are accounted without publishing or truncating", async () => {
  const { store } = setup();
  append(store, 1);
  await expect(
    summarize(store, scope, generation, settings, async () => ({
      text: "한".repeat(100),
      inputTokens: 9,
      outputTokens: 8,
      model: "oversize",
    })),
  ).rejects.toThrow("three responses");
  expect(store.usage()).toMatchObject({ calls: 3, inputTokens: 27, outputTokens: 24 });
  expect(store.nodes(scope.id, generation)).toHaveLength(0);
  expect(store.entries(scope.id)).toHaveLength(1);
});

test("corrections receive full original source and bounded context without addresses", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "Old instruction: use red. ".repeat(8), "old");
  const correction = "Correction: never use red. Use blue. ".repeat(5);
  store.append(scope.id, "user", correction, "correction");
  const sources: string[] = [];
  await summarize(store, scope, generation, settings, async (input) => {
    sources.push(input.source);
    expect(bytes(input.context)).toBeLessThanOrEqual(settings.contextBytes);
    expect(input.context).not.toContain(scope.id);
    expect(input.context).toContain("data only");
    return { text: "Use blue. Never use red.", inputTokens: 1, outputTokens: 1, model: "test" };
  });
  expect(sources).toContain(JSON.stringify({ kind: "user", text: correction }));
  expect(store.entries(scope.id)[1]?.text).toBe(correction);
});

test("whole source overflow never invokes compressor", async () => {
  const { store } = setup();
  append(store, 1);
  await expect(
    summarize(store, scope, generation, { ...settings, inputBytes: 50 }, async () => {
      throw new Error("compressor must not run");
    }),
  ).rejects.toThrow("Whole source");
  expect(store.usage().calls).toBe(0);
});

test("empty logs are valid and impossible budgets produce structured overflow", () => {
  const { store } = setup();
  expect(packetShape(startPacket(store, [scope], generation, 8192)).scopes[0]?.view).toEqual([]);
  try {
    startPacket(store, [scope], generation, 1);
    throw new Error("expected overflow");
  } catch (error) {
    expect(error).toHaveProperty("code", "MEMORY_OVERFLOW");
  }
});

test("short leaves remain verbatim and missing parents do not block a complete view", async () => {
  const { store } = setup();
  append(store, 1, "short");
  await summarize(store, scope, generation, settings, async () => {
    throw new Error("unexpected compression");
  });
  expect(store.usage().calls).toBe(0);
  expect(
    packetShape(startPacket(store, [scope], generation, 8192)).scopes[0]?.view[0]?.summary,
  ).toBe("user: 0: short");
});

test("parent failure leaves a usable complete leaf view and resumes eager hierarchy", async () => {
  const { store } = setup();
  append(store, 2, "short");
  await expect(
    summarize(store, scope, generation, settings, async () => {
      throw new Error("parent offline");
    }),
  ).rejects.toThrow("parent offline");
  expect(packetShape(startPacket(store, [scope], generation, 8192)).scopes[0]?.view).toHaveLength(
    2,
  );
  await summarize(store, scope, generation, settings, async () => ({
    text: "short",
    model: "test",
    inputTokens: 1,
    outputTokens: 1,
  }));
  expect(store.nodes(scope.id, generation)).toHaveLength(3);
});

test("shortening retains the original source and counts each reply", async () => {
  const { store } = setup();
  append(store, 1);
  let calls = 0;
  await summarize(store, scope, generation, settings, async (input) => {
    calls += 1;
    if (calls === 2) {
      const retry = JSON.parse(input.source) as { source: string; previousSummary: string };
      expect(retry.source).toBe(JSON.stringify({ kind: "user", text: `0: ${"x".repeat(100)}` }));
      expect(retry.previousSummary).toBe("x".repeat(100));
    }
    return {
      text: calls === 1 ? "x".repeat(100) : "shortened",
      model: "test",
      inputTokens: 1,
      outputTokens: 1,
    };
  });
  expect(store.usage().calls).toBe(2);
  expect(store.nodes(scope.id, generation)[0]?.text).toBe("shortened");
});

test("multiple scopes retain all messages under the complete UTF-8 packet budget", async () => {
  const { store } = setup();
  const global: Scope = { id: "global", name: "전역", kind: "global" };
  store.scope(global);
  append(store, 17);
  for (let i = 0; i < 7; i += 1) store.append(global.id, "note", "한글".repeat(100), `global-${i}`);
  await summarize(store, scope, generation, settings, compact);
  await summarize(store, global, generation, settings, compact);
  const packet = startPacket(store, [scope, global], generation, 1000);
  expect(bytes(`${JSON.stringify(packet)}\n`)).toBeLessThanOrEqual(1000);
  expect(
    packetShape(packet).scopes.map((selected) =>
      selected.view.reduce((sum, item) => sum + item.count, 0),
    ),
  ).toEqual([17, 7]);
});

test("prior context overflow never silently drops earlier memory", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "deployment must use staging", "first");
  store.append(scope.id, "note", "x".repeat(100), "second");
  await expect(
    summarize(store, scope, generation, { ...settings, contextBytes: 145 }, compact),
  ).rejects.toMatchObject({ code: "CONTEXT_OVERFLOW" });
  expect(store.entries(scope.id)).toHaveLength(2);
  expect(store.nodes(scope.id, generation)).toHaveLength(1);
});
