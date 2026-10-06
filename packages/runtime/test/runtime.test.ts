import { expect, test } from "bun:test";
import { definePlugin, type ToolSession } from "@mcp-cli/core";
import { runService } from "../src";
import { manifest } from "../../../plugins/demo/src/generated";

const plugin = definePlugin({
  name: "demo",
  summary: "Demo",
  connection: () => ({ type: "stdio", command: "unused" }),
});
const fixture = (error = false) => {
  const output: string[] = [];
  const calls: unknown[] = [];
  let opened = 0;
  let closed = 0;
  const session: ToolSession = {
    listTools: async () => {
      throw new Error("Runtime must not discover tools");
    },
    callTool: async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "hello" }], isError: error };
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
      readFile: async () => '{"text":"file"}',
      readStdin: async () => '{"text":"stdin"}',
    },
  };
  return { output, calls, dependencies, counts: () => ({ opened, closed }) };
};
test("progressive help and discovery never open a connection", async () => {
  const f = fixture();
  for (const args of [
    [],
    ["--help"],
    ["message"],
    ["help", "message", "echo"],
    ["message", "echo", "--help"],
    ["call", "demo-echo", "--help"],
    ["methods", "message", "--json"],
    ["skill"],
  ]) {
    expect(await runService(plugin, manifest, args, f.dependencies)).toBe(0);
  }
  expect(f.counts()).toEqual({ opened: 0, closed: 0 });
  expect(f.output[0]).not.toContain("--text");
  expect(f.output[2]).not.toContain("--text");
  expect(f.output[3]).toContain("--text  string (required)");
  expect(JSON.parse(f.output[6] ?? "[]")).toHaveLength(2);
});
test("schema-driven flags preserve strings and map nested fields", async () => {
  const f = fixture();
  await runService(
    plugin,
    manifest,
    [
      "message",
      "echo",
      "--text",
      "001",
      "--count",
      "2",
      "--no-uppercase",
      "--labels",
      '["x"]',
      "--parent.page-id",
      "123",
    ],
    f.dependencies,
  );
  expect(f.calls).toEqual([
    {
      name: "demo-echo",
      input: { text: "001", count: 2, uppercase: false, labels: ["x"], parent: { page_id: "123" } },
    },
  ]);
  expect(f.counts()).toEqual({ opened: 1, closed: 1 });
});
test("raw calls use the same validation as mapped commands", async () => {
  const f = fixture();
  for (const args of [
    ["message", "echo"],
    ["call", "demo-echo", "--input", '{"text":"ok","count":99}'],
    ["message", "echo", "--text", "ok", "--unknown", "x"],
  ]) {
    await expect(runService(plugin, manifest, args, f.dependencies)).rejects.toThrow();
  }
  expect(f.counts().opened).toBe(0);
});
test("JSON, stdin and file input support the same tool", async () => {
  const f = fixture();
  for (const args of [
    ["--input", '{"text":"json"}'],
    ["--input", "-"],
    ["--input-file", "input.json"],
  ]) {
    await runService(plugin, manifest, ["call", "demo-echo", ...args, "--json"], f.dependencies);
  }
  expect(f.calls).toEqual(
    ["json", "stdin", "file"].map((text) => ({ name: "demo-echo", input: { text } })),
  );
  expect(f.counts()).toEqual({ opened: 3, closed: 3 });
});
test("invalid flags and prototype paths fail before opening", async () => {
  for (const args of [
    ["--text"],
    ["--text", "a", "--text", "b"],
    ["--input", "[]"],
    ["--input", "{}", "--text", "x"],
    ["--__proto__.polluted", "yes"],
    ["--no-text"],
  ]) {
    const f = fixture();
    await expect(
      runService(plugin, manifest, ["message", "echo", ...args], f.dependencies),
    ).rejects.toThrow();
    expect(f.counts().opened).toBe(0);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
test("tool errors return nonzero and close the session", async () => {
  const f = fixture(true);
  expect(await runService(plugin, manifest, ["message", "fail"], f.dependencies)).toBe(1);
  expect(f.counts()).toEqual({ opened: 1, closed: 1 });
});
test("call failures still close the session", async () => {
  let closed = false;
  const f = fixture();
  f.dependencies.open = async () => ({
    listTools: async () => [],
    callTool: async () => {
      throw new Error("Call failed");
    },
    close: async () => {
      closed = true;
    },
  });
  await expect(
    runService(plugin, manifest, ["message", "echo", "--text", "x"], f.dependencies),
  ).rejects.toThrow();
  expect(closed).toBe(true);
});
test("plugin policy runs before connection for mapped and raw calls", async () => {
  const guarded = {
    ...plugin,
    beforeCall: async () => {
      throw new Error("Policy blocked");
    },
  };
  const f = fixture();
  for (const path of [
    ["message", "echo"],
    ["call", "demo-echo"],
  ]) {
    await expect(
      runService(guarded, manifest, [...path, "--text", "x"], f.dependencies),
    ).rejects.toThrow();
  }
  expect(f.counts().opened).toBe(0);
});

test("global-looking string values survive mapped and raw calls", async () => {
  for (const path of [
    ["message", "echo"],
    ["call", "demo-echo"],
  ]) {
    for (const text of ["--help", "--json", "-h"]) {
      const f = fixture();
      await runService(plugin, manifest, [...path, "--text", text], f.dependencies);
      expect(f.calls).toEqual([{ name: "demo-echo", input: { text } }]);
      expect(f.counts()).toEqual({ opened: 1, closed: 1 });
      expect(f.output).toEqual(["hello"]);
    }
  }
});

test("global options work around boolean flags and preserve argv", async () => {
  const f = fixture();
  const args = ["--json", "message", "echo", "--uppercase", "--text", "--help", "--json"];
  const original = [...args];
  await runService(plugin, manifest, args, f.dependencies);
  expect(f.calls).toEqual([{ name: "demo-echo", input: { uppercase: true, text: "--help" } }]);
  expect(f.output[0]).toContain('"content"');
  expect(args).toEqual(original);
});

test("prototype names in schema do not become inherited flag definitions", async () => {
  const inheritedProperties = Object.create({ toString: { type: "boolean" } });
  const customManifest = {
    ...manifest,
    commands: [
      {
        name: "custom",
        path: ["custom"],
        inputSchema: {
          type: "object",
          properties: inheritedProperties,
          additionalProperties: false,
        },
      },
    ],
  };
  const f = fixture();
  await expect(
    runService(plugin, customManifest, ["custom", "--toString"], f.dependencies),
  ).rejects.toThrow("Missing value");
  expect(f.counts().opened).toBe(0);
});

test("validator ignores inherited required input fields", async () => {
  const { validateInput } = await import("@mcp-cli/schema");
  const input = Object.create({ text: "inherited" });
  expect(() =>
    validateInput(
      { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      input,
    ),
  ).toThrow("Invalid input");
});
