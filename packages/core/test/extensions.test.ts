import { expect, test } from "bun:test";
import {
  applyCustomizations,
  type ExtensionCommand,
  type GeneratedManifest,
  type ServicePlugin,
} from "../src";

const generated: GeneratedManifest = {
  version: 2,
  service: "demo",
  tools: [{ name: "echo", inputSchema: { type: "object" } }],
};
const extension = (overrides: Partial<ExtensionCommand> = {}): ExtensionCommand => ({
  path: ["flow", "run"],
  kind: "workflow",
  summary: "Run a workflow",
  inputSchema: { type: "object" },
  run: async () => ({ result: { content: [] } }),
  ...overrides,
});
const plugin = (commands: ExtensionCommand[]): ServicePlugin => ({
  name: "demo",
  summary: "Demo",
  connection: () => ({ type: "stdio", command: "unused" }),
  commands: { echo: { path: ["message", "echo"] } },
  extensions: { commands },
});

test("extensions retain executable metadata and participate in groups and quickstart", () => {
  const commands = [extension(), extension({ path: ["shortcut"], kind: "alias", tool: "echo" })];
  const resolved = applyCustomizations(
    {
      ...plugin(commands),
      groups: { flow: "Workflows" },
      quickstart: [
        { command: "flow run", summary: "Run" },
        { command: "shortcut", summary: "Echo" },
      ],
    },
    generated,
  );
  expect(resolved.extensions).toEqual(commands);
  expect(resolved.commands.map(({ name }) => name)).toEqual(["echo"]);
  expect(resolved.groups).toEqual({ flow: "Workflows" });
  expect(resolved.quickstart).toHaveLength(2);
});

test("extension paths reject invalid segments and reserved roots", () => {
  for (const path of [
    [],
    [""],
    ["bad path"],
    ["x.y"],
    ["help"],
    ["methods", "x"],
    ["call", "flow"],
    ["resources", "x"],
    ["prompts", "x"],
    ["skill"],
  ])
    expect(() => applyCustomizations(plugin([extension({ path })]), generated)).toThrow();
});

test("extension paths reject duplicate and prefix collisions with tools and extensions", () => {
  for (const path of [["message"], ["message", "echo"], ["message", "echo", "more"]])
    expect(() => applyCustomizations(plugin([extension({ path })]), generated)).toThrow(
      "Conflicting",
    );
  for (const path of [["flow"], ["flow", "run"], ["flow", "run", "more"]])
    expect(() =>
      applyCustomizations(plugin([extension(), extension({ path })]), generated),
    ).toThrow("Conflicting");
});

test("extension paths reserve absent optional mappings too", () => {
  for (const path of [["optional"], ["optional", "run"], ["optional", "run", "more"]]) {
    const configured = plugin([extension({ path })]);
    configured.commands = {
      ...configured.commands,
      missing: { path: ["optional", "run"], optional: true },
    };
    expect(() => applyCustomizations(configured, generated)).toThrow("Conflicting");
  }
});

test("aliases must reference a generated tool and cannot reference a workflow", () => {
  for (const tool of [undefined, "missing", "flow run"])
    expect(() =>
      applyCustomizations(
        plugin([extension(), extension({ path: ["shortcut"], kind: "alias", tool })]),
        generated,
      ),
    ).toThrow("missing tool");
});
