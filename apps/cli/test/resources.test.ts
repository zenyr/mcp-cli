import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./host";

const sandbox = mkdtempSync(join(tmpdir(), "mcp-cli-resources-"));
const env = {
  HOME: sandbox,
  XDG_CONFIG_HOME: join(sandbox, "config"),
  XDG_STATE_HOME: join(sandbox, "state"),
  MCP_CLI_DAEMON: "0",
  MCP_CLI_INTERNAL_PLUGINS: "only",
};
const run = (...args: string[]) => runCli(["demo", ...args], { env });

test("demo resources list and read over stdio", async () => {
  expect(await run("resources", "list")).toEqual({
    stdout: "demo://readme  Demo README  text/markdown  Short description of the demo server\n",
    stderr: "",
    code: 0,
  });
  const read = await run("resources", "read", "demo://readme");
  expect(read.code).toBe(0);
  expect(read.stdout).toStartWith("# Demo\n");
  const json = await run("resources", "read", "demo://readme", "--json");
  expect(JSON.parse(json.stdout)).toEqual([
    expect.objectContaining({ uri: "demo://readme", mimeType: "text/markdown" }),
  ]);
  expect((await run("resources", "read", "demo://missing")).code).toBe(1);
});

test("demo prompts list and get over stdio", async () => {
  const list = await run("prompts", "list");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("summarize  Ask for a summary of a text");
  expect(list.stdout).toContain("--text (required)");
  expect(await run("prompts", "get", "summarize", "--text", "hello", "--style", "short")).toEqual({
    stdout: "user:\nSummarize in short style:\nhello\n",
    stderr: "",
    code: 0,
  });
  const json = await run("prompts", "get", "summarize", "--input", '{"text":"x"}', "--json");
  expect(JSON.parse(json.stdout)).toHaveProperty("description", "Summary request");
});

test("demo prompt argument errors and help exit with usage status", async () => {
  expect((await run("prompts", "get", "summarize")).code).toBe(2);
  expect((await run("prompts", "get", "summarize", "--text", "x", "--bogus", "y")).code).toBe(2);
  expect((await run("prompts", "get", "missing")).code).toBe(2);
  expect((await run("resources", "bogus")).code).toBe(2);
  const help = await run("prompts", "--help");
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("get <name>");
  expect((await run("--help")).stdout).toContain("  resources");
});
