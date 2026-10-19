import { expect, test } from "bun:test";
import { definePlugin, isRecord, type GeneratedManifest } from "@mcp-cli/core";
import { runService } from "../src";
import { catalogStub } from "./fixtures/manifest";

const sourceDescription = "Server introduction.\n\n" + "Detailed source instructions. ".repeat(100);
const fieldDescription = "A short field summary. " + "Extended field constraints. ".repeat(100);
const plugin = definePlugin({
  name: "sample",
  summary: "Sample service",
  connection: () => ({ type: "stdio", command: "unused" }),
  commands: {
    inspect: {
      path: ["record", "show"],
      summary: "Inspect a record",
      rules: ["Read the record before editing it."],
      examples: ["sample record show --text hello"],
    },
    long: { path: ["record", "long"], summary: "Long summary " + "word ".repeat(100) },
  },
  groups: { record: "Inspect records" },
});
const manifest: GeneratedManifest = {
  version: 2,
  service: "sample",
  tools: [
    {
      name: "inspect",
      description: sourceDescription,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: fieldDescription },
          options: {
            type: "object",
            properties: { nestedChoice: { type: "string", enum: ["nested-alpha", "nested-beta"] } },
          },
        },
      },
      outputSchema: { type: "object", properties: { result: { type: "string" } } },
    },
    { name: "long", inputSchema: { type: "object" } },
  ],
};
const unavailable = async (): Promise<never> => {
  throw new Error("Discovery connected to a server");
};
const discover = async (args: string[]) => {
  const output: string[] = [];
  const code = await runService(plugin, manifest, args, {
    open: unavailable,
    io: {
      write: (text) => {
        output.push(text);
      },
      writeError: unavailable,
      readFile: unavailable,
      readBytes: unavailable,
      readStdin: unavailable,
    },
  });
  expect(code).toBe(0);
  return output.join("\n");
};

test("root and group discovery keep schemas and long descriptions out", async () => {
  for (const args of [["--help"], ["record", "--help"], ["record", "--help=full"]]) {
    const text = await discover(args);
    expect(text).not.toContain("Arguments:");
    expect(text).not.toContain("nestedChoice");
    expect(text).not.toContain("Extended field constraints");
    expect(text).toContain("Next:");
  }
});

test("concise help preserves rules and examples and links to the full specification", async () => {
  const text = await discover(["record", "show", "--help"]);
  expect(text).toContain("--text  string (optional) - A short field summary.");
  expect(text).toContain("Read the record before editing it.");
  expect(text).toContain("sample record show --text hello");
  expect(text).toContain("Full specification: sample record show --help=full");
  expect(text).not.toContain("Detailed source instructions");
  expect(text).not.toContain("Extended field constraints");
  expect(text).not.toContain("nested-alpha");
  expect(text.length).toBeLessThan(1200);
});

test("full help exposes complete source descriptions and nested input/output schemas on both paths", async () => {
  for (const args of [
    ["record", "show", "--help=full"],
    ["call", "inspect", "--help=full"],
    ["help", "record", "show", "--help=full"],
  ]) {
    const text = await discover(args);
    expect(text).toContain(sourceDescription);
    expect(text).toContain(fieldDescription);
    expect(text).toContain('"nestedChoice"');
    expect(text).toContain('"nested-alpha"');
    expect(text).toContain("Input schema:");
    expect(text).toContain("Output schema:");
  }
});

test("methods and group help use the same bounded summaries", async () => {
  const text = await discover(["record", "--help"]);
  const methods: unknown = JSON.parse(await discover(["methods", "record", "--json"]));
  if (!Array.isArray(methods)) throw new Error("Expected a methods array");
  for (const method of methods) {
    if (!isRecord(method) || typeof method.summary !== "string")
      throw new Error("Expected a method summary");
    expect(method.summary.length).toBeLessThanOrEqual(80);
    expect(method.summary).not.toContain("\n");
    expect(text).toContain(method.summary);
  }
});

test("a help-looking inline field value is still sent as data", async () => {
  const calls: unknown[] = [];
  const code = await runService(plugin, manifest, ["record", "show", "--text=--help=full"], {
    open: async () => ({
      ...catalogStub,
      listTools: unavailable,
      callTool: async (name, input) => {
        calls.push({ name, input });
        return { content: [] };
      },
      close: async () => {},
    }),
    io: {
      write: () => {},
      writeError: unavailable,
      readFile: unavailable,
      readBytes: unavailable,
      readStdin: unavailable,
    },
  });
  expect(code).toBe(0);
  expect(calls).toEqual([{ name: "inspect", input: { text: "--help=full" } }]);
});
