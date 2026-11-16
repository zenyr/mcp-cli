import { expect, test } from "bun:test";
import {
  definePlugin,
  type GeneratedManifest,
  type ToolDefinition,
  type ToolSession,
} from "@mcp-cli/core";
import { runService, type RuntimeDependencies } from "../src";
import { catalogStub } from "./fixtures/manifest";

const old: ToolDefinition = { name: "old", inputSchema: { type: "object" } };
const live: ToolDefinition = {
  name: "set",
  inputSchema: {
    type: "object",
    properties: { enabled: { type: "boolean" } },
    required: ["enabled"],
  },
};
const bootstrap: GeneratedManifest = { version: 2, service: "demo", tools: [old] };
const plugin = definePlugin({
  name: "demo",
  summary: "demo",
  discovery: { tools: "session" },
  commands: { old: { path: ["old"] }, set: { path: ["set"] } },
  connection: () => ({ type: "stdio", command: "unused" }),
});
const fixture = (tools: ToolDefinition[] = [live], failure?: Error) => {
  const output: string[] = [];
  const events: unknown[] = [];
  const session: ToolSession = {
    ...catalogStub,
    listTools: async () => {
      events.push("list");
      if (failure) throw failure;
      return tools;
    },
    callTool: async (name, input) => {
      events.push({ name, input });
      return { content: [] };
    },
    close: async () => {
      events.push("close");
    },
  };
  const ports: RuntimeDependencies = {
    open: async (credential) => {
      events.push({ open: credential });
      return session;
    },
    io: {
      write: (text) => output.push(text),
      writeError: (text) => output.push(text),
      readFile: async () => "",
      readStdin: async () => "",
      readBytes: async () => new Uint8Array(),
    },
  };
  return { ports, output, events };
};

test("session discovery parses boolean flags using live schemas and closes the same connection", async () => {
  const f = fixture();
  await runService(plugin, bootstrap, ["set", "--enabled"], f.ports);
  expect(f.events).toEqual([
    { open: undefined },
    "list",
    { name: "set", input: { enabled: true } },
    "close",
  ]);
});

test("root help and skill are offline and identify bootstrap data", async () => {
  for (const argv of [[], ["--help"], ["help"], ["skill"]]) {
    const f = fixture([], new Error("offline"));
    await runService(plugin, bootstrap, argv, f.ports);
    expect(f.events).toEqual([]);
    expect(f.output.join("\n")).toContain("Bootstrap catalog");
  }
});

test("methods, schema and tool help require live discovery and remove stale tools", async () => {
  for (const argv of [
    ["methods", "--json"],
    ["schema", "set"],
    ["set", "--help"],
    ["help", "set"],
  ]) {
    const f = fixture();
    await runService(plugin, bootstrap, argv, f.ports);
    expect(f.events).toEqual([{ open: undefined }, "list", "close"]);
    expect(f.output.join("\n")).not.toContain('"tool": "old"');
  }
  const empty = fixture([]);
  await runService(plugin, bootstrap, ["methods", "--json"], empty.ports);
  expect(empty.output).toEqual(["[]"]);
});

test("discovery failure, invalid schema and duplicate tools dispatch nothing and finalize", async () => {
  for (const f of [
    fixture([], new Error("offline")),
    fixture([{ ...live, inputSchema: { type: "bogus" } }]),
    fixture([live, live]),
  ]) {
    await expect(runService(plugin, bootstrap, ["set", "--enabled"], f.ports)).rejects.toThrow();
    expect(f.events).toEqual([{ open: undefined }, "list", "close"]);
  }
});

test("workspace and credential selection precede discovery", async () => {
  const f = fixture();
  const p = {
    ...plugin,
    auth: {
      type: "apiKey" as const,
      env: "BASE",
      alternates: [{ flag: "other", env: "OTHER", summary: "Other account" }],
    },
  };
  await runService(p, bootstrap, ["set", "--enabled", "--workspace", "two", "--other"], {
    ...f.ports,
    forWorkspace: async (workspace) => {
      f.events.push({ workspace });
      return { ...f.ports, workspaceId: workspace };
    },
  });
  expect(f.events).toEqual([
    { workspace: "two" },
    { open: "other" },
    "list",
    { name: "set", input: { enabled: true } },
    "close",
  ]);
});

test("missing live tools cannot be dispatched through bootstrap paths", async () => {
  const f = fixture([]);
  await expect(runService(plugin, bootstrap, ["old", "--input", "{}"], f.ports)).rejects.toThrow();
  expect(f.events).toEqual([{ open: undefined }, "list", "close"]);
});

test("session discovery preserves authentication failures and closes after parsing failures", async () => {
  const auth = new Error("login required");
  const f = fixture([], auth);
  const error = await runService(plugin, bootstrap, ["methods"], f.ports).catch(
    (error: unknown) => error,
  );
  expect(error).toBe(auth);
  const bad = fixture();
  await expect(
    runService(plugin, bootstrap, ["set", "--enabled=invalid"], bad.ports),
  ).rejects.toThrow();
  expect(bad.events).toEqual([{ open: undefined }, "list", "close"]);
});

test("explicit legacy workspace is selected once even without a workspace repeat scope", async () => {
  const f = fixture();
  let selections = 0;
  await runService(plugin, bootstrap, ["set", "--enabled", "--workspace", "legacy"], {
    ...f.ports,
    forWorkspace: async () => {
      selections++;
      return f.ports;
    },
  });
  expect(selections).toBe(1);
  expect(f.events).toEqual([
    { open: undefined },
    "list",
    { name: "set", input: { enabled: true } },
    "close",
  ]);
});

test("new catalogs may reuse a schema id with an account-specific shape", async () => {
  const identifier = "https://example.com/session-input";
  const first = fixture([{ ...live, inputSchema: { ...live.inputSchema, $id: identifier } }]);
  await runService(plugin, bootstrap, ["set", "--enabled"], first.ports);
  const second = fixture([
    {
      ...live,
      inputSchema: { $id: identifier, type: "object", properties: { enabled: { type: "string" } } },
    },
  ]);
  await runService(plugin, bootstrap, ["set", "--enabled", "text"], second.ports);
  expect(second.events).toContainEqual({ name: "set", input: { enabled: "text" } });
});
