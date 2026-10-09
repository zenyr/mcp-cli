import { afterEach, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCompressor, SUMMARY_PROMPT } from "../src/compressor";
import { generationFor, openStore } from "../src/store";
import { summarize } from "../src/tree";
import * as memoryTypes from "../src/types";
import type { Compression, Scope, Settings, Store } from "../src/types";

const settings: Settings = {
  model: "range-only-test",
  baseUrl: "http://127.0.0.1",
  nodeBytes: 64,
  contextBytes: 8192,
  inputBytes: 131072,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};
const project: Scope = { id: "project:range", name: "range", kind: "project" };
const resources: { directory: string; store: Store }[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "mem-range-only-"));
  const store = openStore(join(directory, "memory.sqlite"));
  store.scope(project);
  resources.push({ directory, store });
  return store;
};
const result = (text: string) => ({
  text,
  model: "local-test",
  inputTokens: 7,
  outputTokens: 3,
  usageKnown: true,
});
const completion = (text: string) => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  model: "local-test",
  usage: { prompt_tokens: 7, completion_tokens: 3 },
});
type RequestBody = { messages: { role: string; content: string }[] };
const mock = (reply: (call: number) => string) => {
  const calls: RequestBody[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body: RequestBody = await request.json();
      calls.push(body);
      return Response.json(completion(reply(calls.length)));
    },
  });
  servers.push(server);
  return { calls, config: { ...settings, baseUrl: `${server.url}v1` } };
};
const userContent = (body: RequestBody | undefined) => {
  expect(body).toBeDefined();
  expect(body?.messages.map((message) => message.role)).toEqual(["system", "user"]);
  const content = body?.messages.find((message) => message.role === "user")?.content;
  expect(content).toBeString();
  return content ?? "";
};
const complete = (store: Store, generation: string, leaves: number, calls: number) => {
  expect(store.status([project], generation)[0]).toMatchObject({ pending: 0, lastError: null });
  expect(store.nodes(project.id, generation).filter((node) => node.l === 0)).toHaveLength(leaves);
  expect(store.usage()).toMatchObject({ calls, inputTokens: calls * 7, outputTokens: calls * 3 });
  const owner = randomUUID();
  store.claim(project.id, generation, owner);
  store.release(project.id, generation, owner);
};
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const { directory, store } of resources.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("later leaf receives only its own kind and text, without earlier tripwires", async () => {
  const store = setup();
  store.append(project.id, "user", "EARLIER_TRIPWIRE", "earlier");
  const text = "Unrelated deployment observation. ".repeat(8);
  store.append(project.id, "tool", text, "later");
  const calls: Compression[] = [];
  await summarize(store, project, "leaf-range", settings, async (input) => {
    calls.push(input);
    return result("Deployment observation.");
  });
  const leaf = calls.find((input) => !input.merge);
  expect(leaf).toBeDefined();
  expect(JSON.parse(leaf?.source ?? "null")).toEqual({ kind: "tool", text });
  expect(JSON.stringify(leaf)).not.toContain("EARLIER_TRIPWIRE");
  expect(Object.keys(leaf ?? {}).sort()).toEqual(["merge", "source", "targetBytes"]);
  complete(store, "leaf-range", 2, calls.length);
});

test("a later parent receives exactly its two child summaries without prefix memory", async () => {
  const store = setup();
  for (const [i, text] of ["PREFIX_TRIPWIRE", "prefix sibling", "left", "right"].entries())
    store.append(project.id, "note", text.repeat(30), `entry-${i}`);
  const calls: Compression[] = [];
  await summarize(store, project, "parent-range", settings, async (input) => {
    calls.push(input);
    if (!input.merge) {
      const leaf: { text: string } = JSON.parse(input.source);
      return result(
        `${leaf.text.startsWith("PREFIX") ? "PREFIX_TRIPWIRE" : leaf.text.slice(0, 5)} ${"s".repeat(30)}`,
      );
    }
    return result("merged range");
  });
  const left = store.node(project.id, "parent-range", 0, 2)?.text;
  const right = store.node(project.id, "parent-range", 0, 3)?.text;
  const parent = calls.find(
    (input) => input.source === JSON.stringify({ summaries: [left, right] }),
  );
  expect(parent).toBeDefined();
  expect(JSON.parse(parent?.source ?? "null")).toEqual({ summaries: [left, right] });
  expect(JSON.stringify(parent)).not.toContain("PREFIX_TRIPWIRE");
  expect(store.nodes(project.id, "parent-range")).toHaveLength(7);
  complete(store, "parent-range", 4, calls.length);
});

test("HTTP retry retains original source and never feeds rejected model text back", async () => {
  const store = setup();
  const text = "Source has only a clean deployment observation. ".repeat(8);
  store.append(project.id, "user", text, "clean");
  const rejected = `HALLUCINATED_TRIPWIRE ${"z".repeat(200)}`;
  const { calls, config } = mock((call) => (call === 1 ? rejected : "Clean observation."));
  await summarize(store, project, "retry-range", config, createCompressor(config, {}));
  expect(calls).toHaveLength(2);
  const first = JSON.parse(userContent(calls[0]));
  const retry = JSON.parse(userContent(calls[1]));
  expect(first.source).toBe(JSON.stringify({ kind: "user", text }));
  expect(retry).toEqual({ ...first, targetBytes: 48, retry: true });
  expect(JSON.stringify(calls)).not.toContain("HALLUCINATED_TRIPWIRE");
  expect(JSON.stringify(calls)).not.toContain("previousSummary");
  expect(store.node(project.id, "retry-range", 0, 0)?.text).toBe("Clean observation.");
  complete(store, "retry-range", 1, 2);
});

test("HTTP adapter whitelists fields even for structural variables with runtime extras", async () => {
  const { calls, config } = mock(() => "clean");
  const input = {
    source: JSON.stringify({ kind: "note", text: "owned source" }),
    merge: false,
    targetBytes: 64,
    retry: true,
    context: "CONTEXT_TRIPWIRE",
    history: ["HISTORY_TRIPWIRE"],
    pins: { secret: "PIN_TRIPWIRE" },
  };
  await createCompressor(config, {})(input);
  await createCompressor(config, {})(input);
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(JSON.parse(userContent(call))).toEqual({
      source: input.source,
      merge: false,
      targetBytes: 64,
      retry: true,
    });
    for (const tripwire of ["CONTEXT_TRIPWIRE", "HISTORY_TRIPWIRE", "PIN_TRIPWIRE"])
      expect(JSON.stringify(call)).not.toContain(tripwire);
  }
});

test("legacy contextBytes=1 does not block clean range compression", async () => {
  const store = setup();
  store.append(project.id, "note", "earlier retained message", "earlier");
  store.append(project.id, "user", "own source ".repeat(40), "own");
  let calls = 0;
  await summarize(store, project, "tiny-context", { ...settings, contextBytes: 1 }, async () => {
    calls += 1;
    return result("Clean range.");
  });
  expect(calls).toBeGreaterThan(0);
  complete(store, "tiny-context", 2, calls);
});

const legacyGeneration = (config: Settings) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        version: 2,
        model: config.model,
        thinking: config.thinking,
        baseUrl: config.baseUrl,
        nodeBytes: config.nodeBytes,
        contextBytes: config.contextBytes,
        inputBytes: config.inputBytes,
      }),
    )
    .digest("hex")
    .slice(0, 24);

test("new policy generation ignores legacy context budget and never reuses poisoned old nodes", async () => {
  const store = setup();
  const text = "Clean original facts. ".repeat(20);
  store.append(project.id, "user", text, "original");
  const old = legacyGeneration(settings);
  const owner = randomUUID();
  store.claim(project.id, old, owner);
  const poison = { l: 0, i: 0, text: "OLD_GENERATION_POISON" };
  store.publish(project.id, old, owner, poison, result(poison.text));
  store.release(project.id, old, owner);
  const generation = generationFor(settings);
  expect(memoryTypes).toHaveProperty("SUMMARY_POLICY", "range-only-v1");
  expect(generation).not.toBe(old);
  expect(generation).toBe(
    createHash("sha256")
      .update(
        JSON.stringify({
          version: 3,
          summaryPolicy: "range-only-v1",
          model: settings.model,
          thinking: settings.thinking,
          baseUrl: settings.baseUrl,
          nodeBytes: settings.nodeBytes,
          inputBytes: settings.inputBytes,
        }),
      )
      .digest("hex")
      .slice(0, 24),
  );
  expect(generationFor({ ...settings, contextBytes: 1 })).toBe(generation);
  const calls: Compression[] = [];
  await summarize(store, project, generation, settings, async (input) => {
    calls.push(input);
    return result("Clean original facts.");
  });
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0]?.source ?? "null")).toEqual({ kind: "user", text });
  expect(JSON.stringify(calls)).not.toContain(poison.text);
  expect(store.node(project.id, old, 0, 0)).toEqual(poison);
  expect(store.node(project.id, generation, 0, 0)?.text).toBe("Clean original facts.");
  complete(store, generation, 1, 1);
});

test("project HTTP input excludes global and private project pins outside the owned range", async () => {
  const store = setup();
  const global: Scope = { id: "global", name: "global", kind: "global" };
  store.scope(global);
  for (const [scope, text] of [
    [global.id, "GLOBAL_PIN_TRIPWIRE"],
    [project.id, "PRIVATE_PIN_TRIPWIRE"],
  ]) {
    if (scope === undefined || text === undefined) throw new Error("Invalid pin fixture");
    const entry = store.append(scope, "note", text, randomUUID());
    store.changePin({
      scope,
      key: "private",
      expectedRevision: 0,
      receipt: randomUUID(),
      op: "pin",
      i: entry.i,
      from: 0,
      to: text.length,
    });
  }
  const text = "This unresolved reference belongs only to this message. ".repeat(5);
  store.append(project.id, "user", text, "range");
  const { calls, config } = mock(() => "Unresolved reference.");
  await summarize(store, project, "pins-range", config, createCompressor(config, {}));
  const leaf = calls.find(
    (call) => JSON.parse(userContent(call)).source === JSON.stringify({ kind: "user", text }),
  );
  expect(leaf).toBeDefined();
  expect(JSON.stringify(leaf)).not.toContain("GLOBAL_PIN_TRIPWIRE");
  expect(JSON.stringify(leaf)).not.toContain("PRIVATE_PIN_TRIPWIRE");
  expect(JSON.stringify(calls)).not.toContain("GLOBAL_PIN_TRIPWIRE");
  expect(store.pins(project.id)[0]?.text).toBe("PRIVATE_PIN_TRIPWIRE");
  complete(store, "pins-range", 2, calls.length);
});

test("summary instructions require unresolved references to remain unresolved", () => {
  expect(SUMMARY_PROMPT).toMatch(/unresolved|ambiguit|ambiguous/i);
  expect(SUMMARY_PROMPT).toMatch(/reference|referent|pronoun/i);
});
