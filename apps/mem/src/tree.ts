import { randomUUID } from "node:crypto";
import type { Compressor, Node, Part, Scope, Settings, Store, SummaryResult } from "./types";
import { bytes, isRecord, nodeKey, start } from "./values";

const verbatim: SummaryResult = { text: "", inputTokens: 0, outputTokens: 0, model: "verbatim" };

const prefix = (text: string, limit: number): string => {
  let size = 0;
  let result = "";
  for (const char of text) {
    size += bytes(char);
    if (size > limit) break;
    result += char;
  }
  return result;
};

// Deterministic stand-in for input the model can never shrink, so `start` is not blocked forever.
const excerpt = (parts: string[], marker: string, limit: number): string => {
  const share = Math.floor((limit - bytes(marker) - parts.length) / parts.length);
  return [...parts.map((part) => prefix(part, Math.max(0, share))).filter(Boolean), marker].join(
    "\n",
  );
};

const codeOf = (error: unknown): unknown => (isRecord(error) ? error.code : undefined);

export const summarize = async (
  store: Store,
  scope: Scope,
  generation: string,
  settings: Settings,
  compress: Compressor,
): Promise<void> => {
  const owner = randomUUID();
  store.claim(scope.id, generation, owner);
  let leaseError: Error | undefined;
  const heartbeat = setInterval(() => {
    try {
      store.renew(scope.id, generation, owner);
    } catch (error) {
      leaseError = error instanceof Error ? error : new Error("Lease renewal failed.");
    }
  }, 30000);
  const renew = () => {
    if (leaseError) throw leaseError;
    store.renew(scope.id, generation, owner);
  };
  try {
    const entries = store.entries(scope.id);
    const nodes = new Map(store.nodes(scope.id, generation).map((node) => [nodeKey(node), node]));
    const errors: unknown[] = [];
    let modelUnavailable = false;
    const shrink = async (
      part: Part,
      source: string,
      raw: string,
    ): Promise<SummaryResult | "excerpt" | "failed"> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        renew();
        let result: SummaryResult;
        try {
          result = await compress({
            source,
            merge: part.l > 0,
            targetBytes: Math.max(1, Math.floor(settings.nodeBytes * (1 - attempt * 0.25))),
            ...(attempt > 0 ? { retry: true } : {}),
          });
        } catch (error) {
          if (codeOf(error) === "SUMMARY_INPUT_OVERFLOW") return "excerpt";
          if (codeOf(error) === "MODEL_UNAVAILABLE") modelUnavailable = true;
          errors.push(error);
          return "failed";
        }
        store.recordUsage(scope.id, generation, result);
        if (
          result.text.trim().length > 0 &&
          bytes(result.text) <= settings.nodeBytes * 1.25 &&
          bytes(result.text) < bytes(raw)
        )
          return result;
      }
      return "excerpt";
    };
    const build = async (part: Part, source: string, parts: string[], marker: string) => {
      if (nodes.has(nodeKey(part))) return;
      const raw = parts.join("\n");
      let usage = verbatim;
      let text: string | undefined = raw;
      if (bytes(raw) > settings.nodeBytes) {
        if (bytes(source) > settings.inputBytes) text = undefined;
        else if (modelUnavailable) return;
        else {
          const result = await shrink(part, source, raw);
          if (result === "failed") return;
          text = result === "excerpt" ? undefined : result.text;
          usage = result === "excerpt" ? verbatim : result;
        }
      }
      renew();
      const node: Node = { ...part, text: text ?? excerpt(parts, marker, settings.nodeBytes) };
      store.publish(scope.id, generation, owner, node, usage);
      nodes.set(nodeKey(node), node);
    };
    for (const entry of entries)
      await build(
        { l: 0, i: entry.i },
        JSON.stringify({ kind: entry.kind, text: entry.text }),
        [`${entry.kind}: ${entry.text}`],
        `[unsummarized; mem read ${scope.id}/${entry.i}]`,
      );
    for (let l = 1; 2 ** l <= entries.length; l += 1)
      for (let i = 0; (i + 1) * 2 ** l <= entries.length; i += 1) {
        const left = nodes.get(nodeKey({ l: l - 1, i: i * 2 }));
        const right = nodes.get(nodeKey({ l: l - 1, i: i * 2 + 1 }));
        if (!left || !right) continue;
        await build(
          { l, i },
          JSON.stringify({ summaries: [left.text, right.text] }),
          [left.text, right.text],
          `[unsummarized; mem zoom ${scope.id}/${start({ l, i })} --count ${2 ** l}]`,
        );
      }
    if (errors.length) throw errors[0];
  } catch (error) {
    store.failed(
      scope.id,
      generation,
      owner,
      (error instanceof Error ? error.message : "Summary failed.").slice(0, 1000),
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
    store.release(scope.id, generation, owner);
  }
};
