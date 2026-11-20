import { expect, test } from "bun:test";
import { definePlugin, type CallRecord, type ToolSession } from "@mcp-cli/core";
import { runService, type RuntimeDependencies } from "../src";
import { parseArguments } from "../src/arguments";
import { catalogStub, commands, manifest } from "./fixtures/manifest";

const plugin = definePlugin({
  name: "demo",
  summary: "Demo",
  commands,
  connection: () => ({ type: "stdio", command: "unused" }),
});
const fixture = () => {
  const selected: Array<string | undefined> = [];
  const input: unknown[] = [];
  const output: string[] = [];
  const recorded = new Map<string, CallRecord>();
  const session: ToolSession = {
    ...catalogStub,
    listTools: async () => [],
    close: async () => {},
    callTool: async (_, value) => {
      input.push(value);
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  const ports: RuntimeDependencies = {
    io: {
      write: (value) => output.push(value),
      writeError: (value) => output.push(value),
      readFile: async () => "",
      readBytes: async () => new Uint8Array(),
      readStdin: async () => "",
    },
    open: async () => session,
    guard: {
      begin: async (_, key, tool, attempt) => {
        const previous = recorded.get(key);
        recorded.set(key, { tool, attempt, status: "ok", at: 1 });
        return previous;
      },
      finish: async () => {},
    },
    forWorkspace: async (workspace) => {
      selected.push(workspace);
      return { ...ports, workspaceId: workspace ?? "default" };
    },
  };
  return { ports, selected, input, output };
};

test("workspace is selected before dispatch and separates repeat guards", async () => {
  const f = fixture();
  for (const workspace of ["one", "two"]) {
    expect(
      await runService(
        plugin,
        manifest,
        ["-w", workspace, "message", "echo", "--text", "same"],
        f.ports,
      ),
    ).toBe(0);
  }
  expect(f.selected).toEqual(["one", "two"]);
  expect(f.input).toEqual([{ text: "same" }, { text: "same" }]);
  await expect(
    runService(plugin, manifest, ["message", "echo", "--text", "same", "--workspace=one"], f.ports),
  ).rejects.toThrow("Refusing to repeat");
});

test("discovery stays offline and ignores the configured workspace", async () => {
  const f = fixture();
  await runService(plugin, manifest, ["--help"], f.ports);
  await runService(plugin, manifest, ["schema", "message", "echo"], f.ports);
  expect(f.selected).toEqual([]);
  expect(f.input).toEqual([]);
});

test("workspace flags do not consume literal tool data", () => {
  const parsed = parseArguments(
    ["message", "echo", "--text=--workspace=literal", "-w", "company"],
    () => ({ properties: { text: { type: "string" } } }),
  );
  expect(parsed.workspace).toBe("company");
  expect(parsed.tokens).toEqual([
    { kind: "field", flag: "--text", path: ["text"], raw: "--workspace=literal" },
  ]);
});

test("value flags leave a standalone -w to the workspace selector", () => {
  const parsed = parseArguments(
    ["message", "echo", "--text", "-w", "company", "--note=-w"],
    () => ({ properties: { text: { type: "string" }, note: { type: "string" } } }),
  );
  expect(parsed.workspace).toBe("company");
  expect(parsed.tokens).toEqual([
    { kind: "invalid", message: "Missing value for --text" },
    { kind: "field", flag: "--note", path: ["note"], raw: "-w" },
  ]);
});
