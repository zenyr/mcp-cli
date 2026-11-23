import { readRecord } from "./commands";
import { excerptParent } from "./tree";
import type { Node, Scope, Store } from "./types";
import { bytes, fail, output, positive, serialize } from "./values";

export type ZoomRequest = {
  recordId: string;
  count: number;
  generation: string;
  maxBytes: number;
  cursor?: string;
  json?: boolean;
};

export const zoom = (store: Store, scopes: Scope[], request: ZoomRequest): unknown => {
  const { recordId, count, generation, maxBytes, cursor, json = true } = request;
  positive(maxBytes, "maxBytes", 20480);
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(generation)) fail("INVALID_OPTION", "Invalid generation.");
  if (!Number.isSafeInteger(count) || count < 1 || (BigInt(count) & (BigInt(count) - 1n)) !== 0n)
    fail("INVALID_OPTION", "count must be a positive safe integer power of two.");
  if (cursor !== undefined && count !== 1) fail("INVALID_OPTION", "A cursor requires count 1.");
  const slash = recordId.lastIndexOf("/");
  const scope = recordId.slice(0, slash);
  const indexText = recordId.slice(slash + 1);
  const index = Number(indexText);
  if (slash < 1 || !/^\d+$/.test(indexText) || !Number.isSafeInteger(index))
    fail("INVALID_OPTION", "Invalid record ID.");
  if (!scopes.some((selected) => selected.id === scope))
    fail("RECORD_UNAVAILABLE", "Record is unavailable in selected scopes.");
  if (index % count !== 0 || index > Number.MAX_SAFE_INTEGER - count)
    fail("INVALID_OPTION", "Range must be aligned and have a safe end index.");
  if (index + count > store.entries(scope).length)
    fail("RECORD_UNAVAILABLE", "Range exceeds selected scope history.");
  if (count === 1) {
    const reserved = json
      ? bytes(JSON.stringify({ generation })) - 1
      : bytes(serialize({ generation }, false));
    const page = readRecord(store, scopes, {
      command: "read",
      json,
      text: [recordId],
      maxBytes: maxBytes - reserved,
      limit: 1,
      stdin: false,
      kind: "note",
      ...(cursor === undefined ? {} : { cursor }),
    });
    const result = Object.assign({}, page, { generation });
    output(result, maxBytes, json);
    return result;
  }
  const nodeAt = (l: number, i: number): Node | undefined => {
    const node = store.node(scope, generation, l, i);
    if (node || l === 0) return node;
    const left = nodeAt(l - 1, i * 2);
    const right = left && nodeAt(l - 1, i * 2 + 1);
    return left && right ? excerptParent(scope, generation, left, right) : undefined;
  };
  const width = count / 2;
  const level = Math.log2(width);
  const children = [index, index + width].map((start) => {
    const node = nodeAt(level, start / width);
    if (!node)
      return fail("NODE_UNAVAILABLE", "Child node is unavailable in requested generation.", {
        generation,
        recordId: `${scope}/${start}`,
        count: width,
      });
    return { recordId: `${scope}/${start}`, count: width, summary: node.text };
  });
  const result = { ok: true, generation, children };
  output(result, maxBytes, json);
  return result;
};
