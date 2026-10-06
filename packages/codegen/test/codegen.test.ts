import { expect, test } from "bun:test";
import { applyCustomizations } from "@mcp-cli/core";
import { createManifest, generateModule } from "../src";
import plugin from "./fixtures/plugin";
import snapshot from "./fixtures/tools.json";

test("code generation is deterministic across tool ordering", async () => {
  const forward = createManifest(plugin, snapshot.tools);
  const reverse = createManifest(plugin, [...snapshot.tools].reverse());
  expect(await generateModule(forward)).toBe(await generateModule(reverse));
  const generated = await generateModule(forward);
  expect(generated).toContain("export interface DemoEchoInput {");
  expect(generated).toContain("text: string");
});
test("generated output carries only server-derived tools", async () => {
  const generated = await generateModule(createManifest(plugin, snapshot.tools));
  expect(generated).toStartWith("// @generated");
  expect(generated).toContain('"version": 2');
  for (const text of ['"path"', '"summary"', '"examples"', "createClient"])
    expect(generated).not.toContain(text);
});
test("unmapped tools remain callable without naming guesses", () => {
  const unmapped = { ...plugin, commands: {} };
  const manifest = applyCustomizations(unmapped, createManifest(unmapped, snapshot.tools));
  expect(manifest.commands.at(0)?.path).toEqual(["call", "demo-echo"]);
});
test("duplicate names, stale mappings, reserved and overlapping paths fail", () => {
  expect(() =>
    createManifest(plugin, [...snapshot.tools, ...snapshot.tools.slice(0, 1)]),
  ).toThrow();
  expect(() =>
    createManifest({ ...plugin, commands: { missing: { path: ["x"] } } }, snapshot.tools),
  ).toThrow();
  for (const paths of [
    [["help"], ["x"]],
    [["message"], ["message", "fail"]],
    [["x"], ["x"]],
  ]) {
    const commands = Object.fromEntries(
      snapshot.tools.map((tool, i) => [tool.name, { path: paths[i] ?? [] }]),
    );
    expect(() => createManifest({ ...plugin, commands }, snapshot.tools)).toThrow();
  }
});

test("malformed snapshots and nested schemas fail before generation", () => {
  for (const tools of [
    null,
    {},
    [null],
    [{ name: "x", inputSchema: null }],
    [{ name: "x", inputSchema: { type: "object", properties: [] } }],
    [{ name: "x", inputSchema: { type: "object", properties: { text: { type: "invalid" } } } }],
    [{ name: "x", inputSchema: { type: "object", required: [1] } }],
    [
      {
        name: "x",
        inputSchema: {
          type: "object",
          properties: { text: { $ref: "https://example.test/schema" } },
        },
      },
    ],
  ])
    expect(() => createManifest({ ...plugin, commands: {} }, tools)).toThrow();
});

test("object key ordering does not affect generated source", async () => {
  const left = [
    {
      name: "x",
      inputSchema: { type: "object", properties: { b: { type: "number" }, a: { type: "string" } } },
    },
  ];
  const right = [
    {
      inputSchema: { properties: { a: { type: "string" }, b: { type: "number" } }, type: "object" },
      name: "x",
    },
  ];
  const unmapped = { ...plugin, commands: {} };
  expect(await generateModule(createManifest(unmapped, left))).toBe(
    await generateModule(createManifest(unmapped, right)),
  );
});

const unmapped = { ...plugin, commands: {} };
const objectTool = (name: string, inputSchema: Record<string, unknown>) => ({
  name,
  inputSchema: { type: "object", ...inputSchema },
});

test("TypeScript extension keywords are rejected before compilation", () => {
  const payload = "string }\nconsole.log('x');\nexport interface Z {";
  for (const schema of [
    { properties: { text: { tsType: payload } } },
    { properties: { text: { type: "string", enum: ["a"], tsEnumNames: [payload] } } },
    { tsType: payload },
  ])
    expect(() => createManifest(unmapped, [objectTool("x", schema)])).toThrow(
      /Unsupported schema extension ts/,
    );
});

test("schema titles and ids never name generated types", async () => {
  const item = { type: "object", title: "Manifest", properties: { id: { type: "string" } } };
  const schema = {
    title: "Manifest",
    $id: "ToolCaller",
    $defs: { Item: item },
    properties: { item: { $ref: "#/$defs/Item" }, nested: item },
  };
  const generated = await generateModule(
    createManifest(unmapped, [objectTool("first", schema), objectTool("second", schema)]),
  );
  expect(generated).not.toMatch(/interface (Manifest|ToolCaller)\b/);
  for (const name of ["FirstInput", "FirstInputItem", "SecondInput", "SecondInputItem"])
    expect(generated).toContain(`export interface ${name} {`);
});

test("type names derive from tool names with deterministic collision suffixes", async () => {
  const generated = await generateModule(
    createManifest(unmapped, [objectTool("a-b", {}), objectTool("a_b", {}), objectTool("9x", {})]),
  );
  for (const name of ["Tool9XInput", "ABInput", "ABInput2"])
    expect(generated).toContain(`export interface ${name} {`);
});

test("input properties named like reserved flags still generate", async () => {
  const properties = Object.fromEntries(
    ["json", "help", "input", "input_file", "input-file"].map((key) => [key, { type: "string" }]),
  );
  const tools = [objectTool("x", { properties }), objectTool("y", {})];
  const manifest = createManifest(unmapped, tools);
  expect(manifest.tools.map((tool) => tool.name)).toEqual(["x", "y"]);
  const generated = await generateModule(manifest);
  for (const key of ["json", "help", "input", "input_file", '"input-file"'])
    expect(generated).toContain(`${key}?: string`);
});

test("tool names with dots and slashes generate under call fallback paths", async () => {
  const manifest = createManifest(unmapped, [objectTool("files.read", {}), objectTool("a/b", {})]);
  const resolved = applyCustomizations(unmapped, manifest);
  expect(resolved.commands.map((command) => command.path)).toEqual([
    ["call", "a/b"],
    ["call", "files.read"],
  ]);
  const generated = await generateModule(manifest);
  for (const name of ["FilesReadInput", "ABInput"])
    expect(generated).toContain(`export interface ${name} {`);
});

test("generated manifests keep tool annotations for runtime policy", async () => {
  const tools = [
    { ...snapshot.tools[0], annotations: { readOnlyHint: false, idempotentHint: true } },
  ];
  const manifest = createManifest({ ...plugin, commands: {} }, tools);
  expect(manifest.tools[0]?.annotations).toEqual({ readOnlyHint: false, idempotentHint: true });
  expect(await generateModule(manifest)).toContain('"idempotentHint": true');
});
