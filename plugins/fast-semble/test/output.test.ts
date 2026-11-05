import { expect, test } from "bun:test";
import { formatSearchResult } from "../src/output";
import { formatResult } from "../../../packages/runtime/src/output";
import type { ToolResult } from "@mcp-cli/core";

const item = {
  file_path: "src/auth.ts",
  start_line: 4,
  end_line: 9,
  score: 0.0732421875,
  content: 'export const auth = () => {\n  return "token";\n};',
};
const envelope = (payload: unknown): ToolResult => {
  const text = JSON.stringify(payload);
  return { content: [{ type: "text", text }], structuredContent: { result: text }, isError: false };
};

test("compact output retains snippet bytes and ranked locations without query or scores", () => {
  const result = envelope({
    query: "authentication flow",
    results: [item, { ...item, file_path: "second.ts" }],
  });
  expect(formatSearchResult(result)).toBe(
    `src/auth.ts:4-9\n${item.content}\n\nsecond.ts:4-9\n${item.content}`,
  );
  const compact = formatSearchResult(result) ?? "";
  expect(compact).not.toContain("authentication flow");
  expect(compact).not.toContain(String(item.score));
  expect(compact.length).toBeLessThan(formatResult(result, false).length);
});

test("locations-only output and empty results remain explicit", () => {
  const { content: _content, ...location } = item;
  expect(formatSearchResult(envelope({ query: "auth", results: [location] }))).toBe(
    "src/auth.ts:4-9",
  );
  expect(formatSearchResult(envelope({ query: "missing", results: [] }))).toBe("No matches.");
});

test("multiple repositories retain their prefix to source mapping", () => {
  expect(
    formatSearchResult(
      envelope({
        query: "auth",
        repos: { backend: "/repo/backend", frontend: "https://example.com/frontend" },
        results: [{ ...item, file_path: "backend/src/auth.ts" }],
      }),
    ),
  ).toBe(
    `Repositories:\nbackend: /repo/backend\nfrontend: https://example.com/frontend\n\nbackend/src/auth.ts:4-9\n${item.content}`,
  );
});

test("errors, extra metadata and unexpected payloads keep the original output", () => {
  const valid = { query: "auth", results: [item] };
  for (const result of [
    { ...envelope(valid), isError: true },
    envelope({ ...valid, warning: "Index is incomplete" }),
    envelope({ query: "auth", results: [{ ...item, truncated: true }] }),
    envelope({ query: "auth", results: [{ ...item, start_line: 0 }] }),
    envelope({ query: "auth", results: [{ ...item, file_path: "a\nb.ts" }] }),
    { ...envelope(valid), structuredContent: { warning: "Keep this" } },
    { ...envelope(valid), content: [{ type: "text", text: "not json" }] },
    {
      ...envelope(valid),
      content: [...envelope(valid).content, { type: "text", text: "Warning" }],
    },
  ])
    expect(formatSearchResult(result)).toBeUndefined();
});
