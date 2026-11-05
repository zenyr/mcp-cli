import { expect, test } from "bun:test";
import { UsageError, type ToolSession } from "@mcp-cli/core";
import { runService } from "../../../packages/runtime/src";
import plugin from "../src";
import { manifest } from "../src/generated";

const fixture = () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const output: string[] = [];
  let opened = 0;
  let guarded = 0;
  const session: ToolSession = {
    listTools: async () => [],
    callTool: async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "found" }] };
    },
    listResources: async () => [],
    listResourceTemplates: async () => [],
    readResource: async () => [],
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    close: async () => {},
  };
  const run = (args: string[]) =>
    runService(plugin, manifest, args, {
      open: async () => {
        opened++;
        return session;
      },
      io: {
        write: (text) => output.push(text),
        writeError: (text) => output.push(text),
        readFile: async () => "",
        readBytes: async () => new Uint8Array(),
        readStdin: async () => "",
      },
      guard: {
        begin: async () => {
          guarded++;
          return undefined;
        },
        finish: async () => {},
      },
    });
  return { calls, output, run, opened: () => opened, guarded: () => guarded };
};

test("help and schemas work without starting Semble", async () => {
  const f = fixture();
  expect(await f.run(["--help"])).toBe(0);
  expect(await f.run(["search", "--help"])).toBe(0);
  expect(await f.run(["schema", "find-related"])).toBe(0);
  expect(f.opened()).toBe(0);
  expect(f.output.join("\n")).toContain("--max-snippet-lines");
});

test("positional search preserves literal query, paths, numeric options and read-only repetition", async () => {
  const f = fixture();
  const args = ["search", "quote ' $(echo test)", "./repo with spaces", "--top-k", "3"];
  expect(await f.run(args)).toBe(0);
  expect(await f.run(args)).toBe(0);
  expect(f.calls).toEqual([
    { name: "search", input: { query: args[1], repo: args[2], top_k: 3 } },
    { name: "search", input: { query: args[1], repo: args[2], top_k: 3 } },
  ]);
  expect(f.guarded()).toBe(0);
});

test("related search maps file and line and defaults to current directory", async () => {
  const f = fixture();
  expect(await f.run(["--json", "find-related", "src/auth.ts", "42"])).toBe(0);
  expect(f.calls).toEqual([
    { name: "find_related", input: { file_path: "src/auth.ts", line: 42, repo: "." } },
  ]);
  expect(JSON.parse(f.output[0] ?? "")).toEqual({ content: [{ type: "text", text: "found" }] });
});

test("flags, null snippets, literal positional values and JSON repo arrays reach Semble", async () => {
  const f = fixture();
  expect(
    await f.run(["search", "--query", "auth", "--repo", ".", "--max-snippet-lines", "null"]),
  ).toBe(0);
  expect(await f.run(["search", "--", "--a-symbol"])).toBe(0);
  const input = { query: "auth", repo: ["/a", "/b"], content: "all" };
  expect(await f.run(["search", "--input", JSON.stringify(input)])).toBe(0);
  expect(f.calls.map((call) => call.input)).toEqual([
    { query: "auth", repo: ".", max_snippet_lines: null },
    { query: "--a-symbol", repo: "." },
    input,
  ]);
});

test("invalid and ambiguous arguments fail before a connection opens", async () => {
  const f = fixture();
  for (const args of [
    ["search", "auth", "--top-k", "0"],
    ["search", "auth", "--content", "invalid"],
    ["search", "auth", ".", "--repo", "."],
    ["search", "auth", ".", "../other"],
    ["search", "auth", "--input", "{}"],
    ["search", "--top-k"],
    ["find-related", "file.ts", "invalid"],
  ]) {
    await expect(f.run(args)).rejects.toThrow(UsageError);
  }
  expect(f.opened()).toBe(0);
});

test("normalization preserves discovery and workspace arguments", () => {
  const normalize = plugin.extensions?.normalizeArgv;
  expect(normalize?.(["methods", "--json"])).toEqual(["methods", "--json"]);
  expect(normalize?.(["-w", "local", "search", "auth"])).toEqual([
    "-w",
    "local",
    "search",
    "--query=auth",
    "--repo=.",
  ]);
  expect(() => normalize?.(["search", "--top-k"])).toThrow(UsageError);
});
