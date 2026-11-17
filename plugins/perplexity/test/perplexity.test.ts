import { expect, test } from "bun:test";
import { UsageError } from "@mcp-cli/core";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import pplx from "../src";
import { normalizeArgv } from "../src/argv";
import { manifest } from "../src/generated";

type Case = { args: string[]; tool: string; input: Record<string, unknown> };
const user = (content: string) => ({ messages: [{ role: "user", content }] });

test("help, methods and skill stay offline", async () => {
  const f = recordingPorts();
  for (const args of [["--help"], ["methods", "--json"], ["skill"], ["ask", "--help"]])
    expect(await runService(pplx, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  expect(f.calls).toHaveLength(0);
});

test.each<Case>([
  {
    args: ["search", "bun", "release", "--max-results", "3"],
    tool: "perplexity_search",
    input: { query: "bun release", max_results: 3 },
  },
  {
    args: ["ask", "what", "is", "MCP", "--search-recency-filter", "week"],
    tool: "perplexity_ask",
    input: { ...user("what is MCP"), search_recency_filter: "week" },
  },
  { args: ["reason", "--", "-1 vs 1"], tool: "perplexity_reason", input: user("-1 vs 1") },
  { args: ["research", "WebGPU"], tool: "perplexity_research", input: user("WebGPU") },
  {
    args: ["ask", "--messages", JSON.stringify(user("raw").messages)],
    tool: "perplexity_ask",
    input: user("raw"),
  },
])("$args.0 maps positional words to the tool input", async ({ args, tool, input }) => {
  const f = recordingPorts();
  expect(await runService(pplx, manifest, args, f.ports)).toBe(0);
  expect(f.calls).toEqual([{ name: tool, input }]);
});

test("positional words cannot be mixed with explicit input", () => {
  expect(() => normalizeArgv(["ask", "hi", "--input", "{}"])).toThrow(UsageError);
  expect(() => normalizeArgv(["search", "hi", "--query=x"])).toThrow(UsageError);
  expect(normalizeArgv(["methods", "x"])).toEqual(["methods", "x"]);
});

test("declares API key auth for the hosted server", async () => {
  expect(pplx.auth).toEqual({ type: "apiKey", env: "PERPLEXITY_API_KEY" });
  expect(await pplx.connection({})).toEqual({
    type: "http",
    url: "https://api.perplexity.ai/mcp",
  });
});
