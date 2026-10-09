import { expect, test } from "bun:test";
import { attemptTotals, evaluate, measureCompressor } from "../eval/evaluation";
import { createFixture, proxyCheck } from "../eval/fixture";
import type { Compression, Settings } from "../src/types";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "../src/values";

const input: Compression = {
  source: '{"text":"test"}',
  context: "historical fact",
  merge: false,
  targetBytes: 512,
};
const result = { text: "요약", model: "fake", inputTokens: 12, outputTokens: 3, usageKnown: true };
const settings: Settings = {
  model: "fake",
  baseUrl: "http://localhost",
  nodeBytes: 512,
  contextBytes: 1000000,
  inputBytes: 131072,
  timeoutMs: 1000,
  maxOutputTokens: 1024,
};

test("fixture has stable source labels, long critical records and scalar evidence", () => {
  const fixture = createFixture();
  expect(fixture).toEqual(createFixture());
  expect(fixture.records).toHaveLength(32);
  expect(fixture.records[2]?.kind).toBe("user");
  expect(fixture.records[9]?.kind).toBe("tool");
  expect(fixture.records[3]?.label).toBe("irrelevant-003");
  for (const fact of fixture.facts) {
    for (const address of fact.evidence) {
      const record = fixture.records[address.i];
      expect(record).toBeDefined();
      expect(Buffer.byteLength(record?.text ?? "")).toBeGreaterThan(512);
      expect(address.to).toBe([...(record?.text ?? "")].length);
    }
  }
  expect(() => createFixture(31)).toThrow();
});

test("attempt budget guards the compressor before another call", async () => {
  let calls = 0;
  const measured = measureCompressor(
    async () => {
      calls += 1;
      return result;
    },
    1,
    "system",
  );
  await measured.compress(input);
  await expect(measured.compress(input)).rejects.toThrow("EVAL_CALL_BUDGET_EXHAUSTED");
  expect(calls).toBe(1);
  expect(measured.budgetStopped()).toBe(true);
  expect(measured.attempts).toHaveLength(1);
});

test("failed and incomplete usage remains unknown, retries retain budget", async () => {
  const measured = measureCompressor(
    async () => {
      throw new Error("HTTP failure");
    },
    2,
    "system",
  );
  await expect(measured.compress(input)).rejects.toThrow();
  expect(attemptTotals(measured.attempts)).toMatchObject({
    attempts: 1,
    failures: 1,
    unknownUsage: 1,
  });
  expect(measured.attempts[0]?.inputTokens).toBeNull();
  const incomplete = measureCompressor(async () => ({ ...result, usageKnown: false }), 2, "system");
  await incomplete.compress({ ...input, source: '{"previousSummary":"long"}' });
  expect(attemptTotals(incomplete.attempts)).toMatchObject({
    retries: 1,
    unknownUsage: 1,
    knownInputTokens: 0,
  });
});

test("isolated mode removes context at compressor seam", async () => {
  const contexts: string[] = [];
  const compressor = async (value: Compression) => {
    contexts.push(value.context);
    return result;
  };
  await measureCompressor(compressor, 1, "system").compress(input);
  await measureCompressor(compressor, 1, "isolated").compress(input);
  expect(contexts).toEqual(["historical fact", ""]);
});

test("evaluation observes actual depths and explicit budget stop without retrieval claims", async () => {
  let calls = 0;
  const report = await evaluate({
    settings,
    compress: async () => {
      calls++;
      return result;
    },
    maxCalls: 80,
  });
  expect(report.status).toBe("complete");
  expect(report.maxDepth).toBe(5);
  expect(report.observedDepths).toEqual([0, 1, 2, 4, 5]);
  expect(report.nodes.some((node) => node.depth === 5)).toBe(true);
  expect(report.totals.attempts).toBe(calls);
  expect(report.totals.attempts).toBeLessThan(35);
  expect(report.totals.unknownUsage).toBe(0);
  const stopped = await evaluate({ settings, compress: async () => result, maxCalls: 1 });
  expect(stopped.status).toBe("budget-stopped");
  expect(stopped.totals.attempts).toBe(1);
});

test("literal proxies expose omissions and contradictory candidates without semantic verdict", () => {
  const checks = proxyCheck("production 배포 성공", createFixture().facts);
  expect(checks[0]?.missing).toContain("취소");
  expect(checks[0]?.contradictoryCandidates).toContain("production 배포 성공");
});

test("dry-run CLI stores the manifest and returns a small response without a server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mem-eval-cli-"));
  const path = join(directory, "report.json");
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "../eval/main.ts"),
        "--records",
        "32",
        "--output",
        path,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, MEM_BASE_URL: "http://127.0.0.1:1/v1" },
      },
    );
    const [code, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeLessThan(1024);
    const response: unknown = JSON.parse(stdout);
    if (!isRecord(response)) throw new Error("Invalid response");
    expect(response.status).toBe("dry-run");
    expect(response.outputPath).toBe(path);
    const report: unknown = await Bun.file(path).json();
    expect(report).toHaveProperty("fixture.records");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("256-record reports include the actual deepest structural node", async () => {
  const report = await evaluate({
    settings,
    records: 256,
    compress: async () => result,
    maxCalls: 80,
  });
  expect(report.status).toBe("complete");
  expect(report.maxDepth).toBe(8);
  expect(report.observedDepths).toContain(8);
  expect(report.nodes.some((node) => node.depth === 8 && node.index === 0)).toBe(true);
});
