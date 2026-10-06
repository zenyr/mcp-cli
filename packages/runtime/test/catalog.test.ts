import { expect, test } from "bun:test";
import { UsageError, applyCustomizations, definePlugin, type ToolSession } from "@mcp-cli/core";
import { runService } from "../src";
import { commands, manifest } from "./fixtures/manifest";

const plugin = definePlugin({
  name: "demo",
  summary: "Demo",
  commands,
  connection: () => ({ type: "stdio", command: "unused" }),
});
const prompts = [
  {
    name: "greet",
    description: "Greet someone",
    arguments: [{ name: "who", required: true, description: "Name" }, { name: "tone_hint" }],
  },
];
const fixture = () => {
  const output: string[] = [];
  const gets: unknown[] = [];
  let opened = 0;
  let closed = 0;
  const session: ToolSession = {
    listTools: async () => [],
    callTool: async () => ({ content: [] }),
    listResources: async () => [
      { uri: "demo://a", name: "a", mimeType: "text/plain", description: "First" },
    ],
    listResourceTemplates: async () => [{ uriTemplate: "demo://{id}", name: "item" }],
    readResource: async (uri) => [
      { uri, mimeType: "text/plain", text: "body" },
      { uri, mimeType: "image/png", blob: "AAAA" },
    ],
    listPrompts: async () => prompts,
    getPrompt: async (name, args) => {
      gets.push({ name, args });
      return {
        messages: [
          { role: "user", content: { type: "text", text: `hi ${args.who}` } },
          { role: "assistant", content: { type: "image", data: "AA", mimeType: "image/png" } },
        ],
      };
    },
    close: async () => {
      closed++;
    },
  };
  const dependencies = {
    open: async () => {
      opened++;
      return session;
    },
    io: {
      write: (text: string) => output.push(text),
      writeError: () => undefined,
      readFile: async () => '{"who":"file"}',
      readStdin: async () => '{"who":"stdin"}',
      readBytes: async () => new Uint8Array(),
    },
  };
  const run = (...args: string[]) => runService(plugin, manifest, args, dependencies);
  return { output, gets, run, counts: () => ({ opened, closed }) };
};
const rejects = async (args: string[], message: string, opened: number) => {
  const f = fixture();
  const error = await f.run(...args).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(UsageError);
  expect(error).toHaveProperty("message", expect.stringContaining(message));
  expect(f.counts()).toEqual({ opened, closed: opened });
};

test("help for resources and prompts never connects", async () => {
  const f = fixture();
  for (const args of [
    ["--help"],
    ["resources"],
    ["prompts"],
    ["resources", "--help"],
    ["resources", "list", "--help"],
    ["resources", "read", "demo://a", "-h"],
    ["prompts", "get", "greet", "--who", "x", "--help"],
    ["help", "prompts", "get"],
  ]) {
    expect(await f.run(...args)).toBe(0);
  }
  expect(f.counts()).toEqual({ opened: 0, closed: 0 });
  expect(f.output[0]).toContain("  prompts");
  expect(f.output[0]).toContain("  resources");
  expect(f.output[1]).toContain("Usage: demo resources <command>");
  expect(f.output[2]).toContain("get <name>");
  expect(f.output[6]).toStartWith("Usage: demo prompts");
});

test("resources list, templates and read print text and JSON", async () => {
  const f = fixture();
  await f.run("resources", "list");
  await f.run("resources", "templates");
  await f.run("resources", "read", "demo://a");
  await f.run("resources", "read", "demo://a", "--json");
  await f.run("--json", "resources", "list");
  expect(f.output.slice(0, 3)).toEqual([
    "demo://a  a  text/plain  First",
    "demo://{id}  item",
    "body\n[binary image/png demo://a; use --json for base64]",
  ]);
  expect(JSON.parse(f.output[3] ?? "")).toEqual([
    { uri: "demo://a", mimeType: "text/plain", text: "body" },
    { uri: "demo://a", mimeType: "image/png", blob: "AAAA" },
  ]);
  expect(JSON.parse(f.output[4] ?? "")).toHaveLength(1);
  expect(f.counts()).toEqual({ opened: 5, closed: 5 });
});

test("resources reject bad operands and flags before connecting", async () => {
  await rejects(["resources", "read"], "resources read <uri>", 0);
  await rejects(["resources", "read", "a", "b"], "resources read <uri>", 0);
  await rejects(["resources", "list", "extra"], "resources list", 0);
  await rejects(["resources", "list", "--uri", "x"], "does not accept input flags", 0);
  await rejects(["resources", "bogus"], "Unknown command: resources bogus", 0);
});

test("prompts list shows arguments and get renders messages", async () => {
  const f = fixture();
  await f.run("prompts", "list");
  await f.run("prompts", "get", "greet", "--who", "Ada", "--tone-hint", "warm");
  await f.run("prompts", "get", "greet", "--input", '{"who":"json"}', "--json");
  await f.run("prompts", "get", "greet", "--input-file", "args.json");
  expect(f.output[0]).toBe(
    "greet  Greet someone\n  --who (required) - Name\n  --tone-hint (optional)",
  );
  expect(f.output[1]).toBe(
    'user:\nhi Ada\n\nassistant:\n{"type":"image","data":"AA","mimeType":"image/png"}',
  );
  expect(JSON.parse(f.output[2] ?? "")).toHaveProperty("messages.0.content.text", "hi json");
  expect(f.gets).toEqual([
    { name: "greet", args: { who: "Ada", tone_hint: "warm" } },
    { name: "greet", args: { who: "json" } },
    { name: "greet", args: { who: "file" } },
  ]);
  expect(f.counts()).toEqual({ opened: 4, closed: 4 });
});

test("prompt arguments are validated against the listed prompt", async () => {
  await rejects(["prompts", "get", "missing"], "Unknown prompt: missing", 1);
  await rejects(
    ["prompts", "get", "greet"],
    "Missing required argument for prompt greet: --who",
    1,
  );
  await rejects(["prompts", "get", "greet", "--who", "x", "--extra", "y"], "extra", 1);
  await rejects(["prompts", "get", "greet", "--input", '{"who":1}'], "Invalid input", 1);
  await rejects(["prompts", "get", "greet", "--who"], "Missing value for --who", 0);
  await rejects(["prompts", "get"], "prompts get <name>", 0);
  await rejects(["prompts", "list", "--who", "x"], "does not accept input flags", 0);
});

test("plugin command paths cannot start with resources or prompts", () => {
  for (const group of ["resources", "prompts"]) {
    const custom = { ...plugin, commands: { ...commands, "demo-fail": { path: [group, "x"] } } };
    expect(() => applyCustomizations(custom, manifest)).toThrow("Reserved command path");
  }
});
