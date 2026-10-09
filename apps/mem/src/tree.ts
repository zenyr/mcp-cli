import { randomUUID } from "node:crypto";
import type { Compressor, Node, Scope, Settings, Store, SummaryResult } from "./types";
import { bytes, fail, nodeKey } from "./values";

const verbatim: SummaryResult = { text: "", inputTokens: 0, outputTokens: 0, model: "verbatim" };

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
    const build = async (
      part: { l: number; i: number },
      source: string,
      raw?: string,
      sourceBytes = bytes(source),
    ) => {
      if (nodes.has(nodeKey(part))) return;
      let text = raw;
      let usage = verbatim;
      if (text === undefined || bytes(text) > settings.nodeBytes) {
        if (bytes(source) > settings.inputBytes)
          fail("INPUT_OVERFLOW", "Whole source exceeds inputBytes.", {
            limit: settings.inputBytes,
          });
        text = undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          renew();
          const result = await compress({
            source,
            merge: part.l > 0,
            targetBytes: Math.max(1, Math.floor(settings.nodeBytes * (1 - attempt * 0.25))),
            ...(attempt > 0 ? { retry: true } : {}),
          });
          store.recordUsage(scope.id, generation, result);
          if (
            result.text.trim().length > 0 &&
            bytes(result.text) <= settings.nodeBytes * 1.25 &&
            bytes(result.text) < (raw === undefined ? sourceBytes : bytes(raw))
          ) {
            text = result.text;
            usage = result;
            break;
          }
        }
      }
      if (text === undefined)
        return fail("SUMMARY_TOO_LARGE", "Summary did not shrink within three responses.");
      renew();
      const node: Node = { ...part, text };
      store.publish(scope.id, generation, owner, node, usage);
      nodes.set(nodeKey(node), node);
    };
    for (const entry of entries) {
      await build(
        { l: 0, i: entry.i },
        JSON.stringify({ kind: entry.kind, text: entry.text }),
        `${entry.kind}: ${entry.text}`,
      );
      let l = 0;
      let i = entry.i;
      while (i % 2 === 1) {
        const left = nodes.get(nodeKey({ l, i: i - 1 }));
        const right = nodes.get(nodeKey({ l, i }));
        if (!left || !right) break;
        l += 1;
        i = Math.floor(i / 2);
        await build(
          { l, i },
          JSON.stringify({ summaries: [left.text, right.text] }),
          `${left.text}\n${right.text}`,
          bytes(left.text) + bytes(right.text),
        );
      }
    }
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
