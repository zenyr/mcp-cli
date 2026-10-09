import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, generationFor } from "../src/store";
import { summarize } from "../src/tree";
import { SUMMARY_POLICY, type Compressor, type Settings } from "../src/types";
import { isRecord } from "../src/values";
import { bytes } from "../src/values";
import { createFixture, proxyCheck } from "./fixture";

export type Attempt = {
  ordinal: number;
  merge: boolean;
  retry: boolean;
  success: boolean;
  usageKnown: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  sourceBytes: number;
  targetBytes: number;
  externalContextBytes: 0;
  outputBytes: number | null;
};
export const measureCompressor = (
  compress: Compressor,
  maxCalls: number,
  progress?: (attempt: Attempt) => void,
) => {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw new Error("Invalid maxCalls");
  const attempts: Attempt[] = [];
  let budgetStopped = false;
  const measured: Compressor = async (input) => {
    if (attempts.length >= maxCalls) {
      budgetStopped = true;
      throw new Error("EVAL_CALL_BUDGET_EXHAUSTED");
    }
    const attempt: Attempt = {
      ordinal: attempts.length + 1,
      merge: input.merge,
      retry: input.retry === true,
      success: false,
      usageKnown: false,
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
      sourceBytes: bytes(input.source),
      targetBytes: input.targetBytes,
      externalContextBytes: 0,
      outputBytes: null,
    };
    attempts.push(attempt);
    const started = performance.now();
    try {
      const result = await compress({
        source: input.source,
        merge: input.merge,
        targetBytes: input.targetBytes,
        ...(input.retry === undefined ? {} : { retry: input.retry }),
      });
      attempt.success = true;
      attempt.outputBytes = bytes(result.text);
      attempt.usageKnown = result.usageKnown === true;
      if (attempt.usageKnown) {
        attempt.inputTokens = result.inputTokens;
        attempt.outputTokens = result.outputTokens;
      }
      return result;
    } finally {
      attempt.durationMs = performance.now() - started;
      progress?.(attempt);
    }
  };
  return { compress: measured, attempts, budgetStopped: () => budgetStopped };
};

export const attemptTotals = (attempts: Attempt[]) => ({
  attempts: attempts.length,
  success: attempts.filter((item) => item.success).length,
  failures: attempts.filter((item) => !item.success).length,
  unknownUsage: attempts.filter((item) => !item.usageKnown).length,
  retries: attempts.filter((item) => item.retry).length,
  knownInputTokens: attempts.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0),
  knownOutputTokens: attempts.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
  durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
});

export const evaluate = async (options: {
  settings: Settings;
  compress: Compressor;
  records?: number;
  maxCalls?: number;
  progress?: (attempt: Attempt) => void;
}) => {
  const fixture = createFixture(options.records);
  const measured = measureCompressor(options.compress, options.maxCalls ?? 80, options.progress);
  const directory = await mkdtemp(join(tmpdir(), "mem-eval-"));
  const store = openStore(join(directory, "memory.sqlite"));
  const scope = { id: "evaluation", name: "evaluation", kind: "project" } as const;
  const generation = generationFor(options.settings);
  const started = performance.now();
  let status: "complete" | "budget-stopped" | "failed" = "complete";
  let failure: { code: string; message: string } | undefined;
  try {
    store.scope(scope);
    fixture.records.forEach((record, i) =>
      store.append(scope.id, record.kind, record.text, `fixture-${i}`),
    );
    try {
      await summarize(store, scope, generation, options.settings, measured.compress);
    } catch (error) {
      status = measured.budgetStopped() ? "budget-stopped" : "failed";
      failure = {
        code: isRecord(error) && typeof error.code === "string" ? error.code : "EVAL_FAILED",
        message: error instanceof Error ? error.message : "Evaluation failed.",
      };
    }
    const maxDepth = Math.floor(Math.log2(fixture.records.length));
    const depths = [...new Set([0, 1, 2, 4, 8, maxDepth])]
      .filter((depth) => depth <= maxDepth)
      .sort((a, b) => a - b);
    const nodes = store
      .nodes(scope.id, generation)
      .filter((node) => depths.includes(node.l))
      .map((node) => {
        const from = node.i * 2 ** node.l;
        const to = from + 2 ** node.l;
        const relevant = fixture.facts.filter((fact) =>
          fact.evidence.some((address) => address.i >= from && address.i < to),
        );
        return {
          depth: node.l,
          index: node.i,
          interval: [from, to],
          quotedText: node.text,
          proxyChecks: proxyCheck(node.text, relevant),
        };
      });
    return {
      status,
      generation,
      inputPolicy: SUMMARY_POLICY,
      externalContextBytes: 0 as const,
      failure,
      model: options.settings.model,
      nodeBytes: options.settings.nodeBytes,
      settings: {
        inputBytes: options.settings.inputBytes,
        timeoutMs: options.settings.timeoutMs,
        maxOutputTokens: options.settings.maxOutputTokens,
        thinking: options.settings.thinking ?? "provider-default",
      },
      maxCalls: options.maxCalls ?? 80,
      records: fixture.records.length,
      maxDepth,
      selectedDepths: depths,
      observedDepths: [...new Set(nodes.map((node) => node.depth))].sort((a, b) => a - b),
      limitations: [
        "Attempt success means a parsed model response, not acceptance as a summary node.",
        "Literal proxy checks require manual review; they do not measure semantic accuracy.",
        "Contradictory candidates may occur in negated statements; inspect quotedText.",
        "No agent retrieval, oracle discovery, monetary pricing, or model comparison is measured.",
        "Unknown usage is excluded from known token totals; totals are not complete cost estimates.",
      ],
      totals: { ...attemptTotals(measured.attempts), wallDurationMs: performance.now() - started },
      attempts: measured.attempts,
      fixture,
      nodes,
    };
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
};
