import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPacket } from "../src/packets";
import { generationFor, openStore } from "../src/store";
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

test("three oversized replies are accounted and replaced by a marked raw excerpt", async () => {
  const { store } = setup();
  append(store, 1);
  await summarize(store, scope, generation, settings, async () => ({
    text: "한".repeat(100),
    inputTokens: 9,
    outputTokens: 8,
    model: "oversize",
  }));
  expect(store.usage()).toMatchObject({ calls: 3, inputTokens: 27, outputTokens: 24 });
  const text = store.node(scope.id, generation, 0, 0)?.text ?? "";
  expect(text).toBe(`user: 0: ${"x".repeat(15)}\n[unsummarized; mem read ${scope.id}/0]`);
  expect(bytes(text)).toBeLessThanOrEqual(settings.nodeBytes);
  expect(store.entries(scope.id)[0]?.text).toBe(`0: ${"x".repeat(100)}`);
});

test("corrections receive only their full original source without earlier context", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "Old instruction: use red. ".repeat(8), "old");
  const correction = "Correction: never use red. Use blue. ".repeat(5);
  store.append(scope.id, "user", correction, "correction");
  const sources: string[] = [];
  await summarize(store, scope, generation, settings, async (input) => {
    sources.push(input.source);
    expect(input).not.toHaveProperty("context");
    expect(Object.keys(input).sort()).toEqual(["merge", "source", "targetBytes"]);
    return { text: "Use blue. Never use red.", inputTokens: 1, outputTokens: 1, model: "test" };
  });
  expect(sources).toContain(JSON.stringify({ kind: "user", text: correction }));
  expect(store.entries(scope.id)[1]?.text).toBe(correction);
});

test("whole source overflow never invokes compressor", async () => {
  const { store } = setup();
  append(store, 1);
  await summarize(store, scope, generation, { ...settings, inputBytes: 50 }, async () => {
    throw new Error("compressor must not run");
  });
  expect(store.usage().calls).toBe(0);
  expect(store.node(scope.id, generation, 0, 0)?.text).toEndWith(
    `[unsummarized; mem read ${scope.id}/0]`,
  );
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
  append(store, 2, "x".repeat(35));
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
      expect(input.source).toBe(JSON.stringify({ kind: "user", text: `0: ${"x".repeat(100)}` }));
      expect(input.retry).toBe(true);
      expect(input).not.toHaveProperty("previousSummary");
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

test("tiny legacy contextBytes does not block range-only compression", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "deployment must use staging", "first");
  store.append(scope.id, "note", "x".repeat(100), "second");
  await summarize(store, scope, generation, { ...settings, contextBytes: 1 }, async (input) => {
    expect(input).not.toHaveProperty("context");
    if (!input.merge) expect(input.source).not.toContain("staging");
    return compact(input);
  });
  expect(store.entries(scope.id)).toHaveLength(2);
  expect(store.nodes(scope.id, generation)).toHaveLength(3);
});

test("short parents preserve both child summaries without model calls", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "production forbidden", "one");
  store.append(scope.id, "tool", "E731 expired token", "two");
  await summarize(store, scope, generation, settings, async () => {
    throw new Error("No model call is needed");
  });
  expect(store.node(scope.id, generation, 1, 0)?.text).toBe(
    "user: production forbidden\ntool: E731 expired token",
  );
  expect(store.usage().calls).toBe(0);
});

test("new policy generation rebuilds children without reusing contaminated legacy nodes", async () => {
  const { store } = setup();
  append(store, 2);
  const legacy = "legacy-context-generation";
  await summarize(store, scope, legacy, settings, async () => ({
    text: "outside poisoned fact",
    model: "test",
    inputTokens: 1,
    outputTokens: 1,
  }));
  const before = store.nodes(scope.id, legacy);
  const current = generationFor(settings);
  await summarize(store, scope, current, settings, async (input) => {
    expect(input.source).not.toContain("outside poisoned fact");
    return compact(input);
  });
  expect(store.nodes(scope.id, legacy)).toEqual(before);
  expect(store.nodes(scope.id, current)).toHaveLength(3);
  expect(store.nodes(scope.id, current).every((node) => !node.text.includes("poisoned"))).toBe(
    true,
  );
});

const failingSource =
  (marker: string): Compressor =>
  async (input) => {
    if (input.source.includes(marker)) throw new Error(`offline for ${marker}`);
    return compact(input);
  };

test("a failing early leaf does not stop later leaves from being built", async () => {
  const { store } = setup();
  append(store, 5);
  await expect(summarize(store, scope, generation, settings, failingSource("0: "))).rejects.toThrow(
    "offline for 0: ",
  );
  const leaves = store.nodes(scope.id, generation).filter((node) => node.l === 0);
  expect(leaves.map((node) => node.i)).toEqual([1, 2, 3, 4]);
  expect(store.node(scope.id, generation, 1, 1)).toBeDefined();
  expect(store.status([scope], generation)[0]).toMatchObject({
    pending: 1,
    lastError: "offline for 0: ",
  });
});

test("a failing parent does not stop later leaves or sibling parents", async () => {
  const { store } = setup();
  append(store, 6);
  const compress: Compressor = async (input) => {
    if (input.merge && input.source.includes("0: ")) throw new Error("parent offline");
    const text = input.merge ? "merged" : `${input.source.slice(23, 26)}${"m".repeat(35)}`;
    return { ...(await compact(input)), text };
  };
  await expect(summarize(store, scope, generation, settings, compress)).rejects.toThrow(
    "parent offline",
  );
  expect(store.status([scope], generation)[0]?.pending).toBe(0);
  expect(store.node(scope.id, generation, 1, 0)).toBeUndefined();
  expect(store.node(scope.id, generation, 1, 1)?.text).toBe("merged");
  expect(store.node(scope.id, generation, 1, 2)?.text).toBe("merged");
  expect(packetShape(startPacket(store, [scope], generation, 8192)).scopes[0]?.messages).toBe(6);
});

test("an oversized early record publishes a bounded excerpt and keeps start usable", async () => {
  const { store } = setup();
  store.append(scope.id, "user", "y".repeat(20000), "huge");
  append(store, 3, "short");
  await summarize(store, scope, generation, { ...settings, nodeBytes: 80 }, async (input) => {
    if (bytes(input.source) > 10000) throw new Error("compressor must not see oversized input");
    return compact(input);
  });
  const excerpt = store.node(scope.id, generation, 0, 0)?.text ?? "";
  expect(bytes(excerpt)).toBeLessThanOrEqual(80);
  expect(excerpt).toStartWith("user: yyy");
  expect(excerpt).toEndWith(`[unsummarized; mem read ${scope.id}/0]`);
  expect(store.status([scope], generation)[0]).toMatchObject({ pending: 0, lastError: null });
  expect(packetShape(startPacket(store, [scope], generation, 8192)).scopes[0]?.messages).toBe(4);
});

test("a request that exceeds inputBytes with instructions publishes an excerpt", async () => {
  const { store } = setup();
  append(store, 4);
  await summarize(store, scope, generation, settings, async (input) => {
    if (input.source.includes("1: "))
      throw Object.assign(new Error("Summary request exceeds inputBytes."), {
        code: "SUMMARY_INPUT_OVERFLOW",
      });
    return compact(input);
  });
  expect(store.node(scope.id, generation, 0, 1)?.text).toEndWith(
    `[unsummarized; mem read ${scope.id}/1]`,
  );
  expect(store.status([scope], generation)[0]).toMatchObject({ pending: 0, lastError: null });
});

test("persistently oversized summaries publish excerpts so a large tree still fits start", async () => {
  const { store } = setup();
  append(store, 16);
  const oversized: Compressor = async () => ({
    text: "z".repeat(200),
    inputTokens: 1,
    outputTokens: 1,
    model: "oversize",
  });
  await summarize(store, scope, generation, { ...settings, nodeBytes: 96 }, oversized);
  expect(store.nodes(scope.id, generation)).toHaveLength(31);
  expect(store.node(scope.id, generation, 1, 0)?.text).toEndWith(
    `[unsummarized; mem zoom ${scope.id}/0 --count 2]`,
  );
  for (const node of store.nodes(scope.id, generation))
    expect(bytes(node.text)).toBeLessThanOrEqual(96);
  const packet = startPacket(store, [scope], generation, 1024);
  expect(bytes(`${JSON.stringify(packet)}\n`)).toBeLessThanOrEqual(1024);
});

test("unreachable summarizer is called once while model-free nodes are still built", async () => {
  const { store } = setup();
  append(store, 2);
  store.append(scope.id, "user", "s2", "short-2");
  store.append(scope.id, "user", "s3", "short-3");
  let calls = 0;
  const unavailable: Compressor = async () => {
    calls += 1;
    throw Object.assign(new Error("Cannot reach summarizer."), { code: "MODEL_UNAVAILABLE" });
  };
  await expect(summarize(store, scope, generation, settings, unavailable)).rejects.toMatchObject({
    code: "MODEL_UNAVAILABLE",
  });
  expect(calls).toBe(1);
  expect(store.status([scope], generation)[0]?.pending).toBe(2);
  expect(store.node(scope.id, generation, 1, 1)?.text).toBe("user: s2\nuser: s3");
});

test("lease loss still aborts the run before any later node is published", async () => {
  const { store } = setup();
  append(store, 4, "short");
  const lost: Store = {
    ...store,
    renew: () => {
      throw Object.assign(new Error("Summary lease ownership was lost."), { code: "LEASE_LOST" });
    },
  };
  await expect(summarize(lost, scope, generation, settings, compact)).rejects.toMatchObject({
    code: "LEASE_LOST",
  });
  expect(store.nodes(scope.id, generation)).toHaveLength(0);
});
