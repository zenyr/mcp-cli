import { expect, test } from "bun:test";
import {
  UsageError,
  applyCustomizations,
  decodeManifest,
  definePlugin,
  type CommandCustomization,
  type GeneratedManifest,
} from "../src/index";

const tool = { name: "echo", description: "Echo text\nMore", inputSchema: { type: "object" } };
const manifest = { version: 2, service: "demo", tools: [tool] };
const generated = (names: string[]): GeneratedManifest => ({
  version: 2,
  service: "demo",
  tools: names.map((name) => ({ name, inputSchema: { type: "object" } })),
});
const pluginWith = (commands: Record<string, CommandCustomization> = {}) =>
  definePlugin({
    name: "demo",
    summary: "Demo",
    commands,
    connection: () => ({ type: "stdio", command: "unused" }),
  });

test("decodeManifest accepts generated tools and keeps optional fields", () => {
  const decoded = decodeManifest({ ...manifest, tools: [{ ...tool, outputSchema: {} }] });
  expect(decoded.tools[0]).toEqual({ ...tool, outputSchema: {} });
});

test("decodeManifest rejects malformed manifests", () => {
  for (const value of [
    null,
    { ...manifest, version: 3 },
    { ...manifest, service: "" },
    { ...manifest, tools: {} },
    { ...manifest, tools: [{ ...tool, name: 1 }] },
    { ...manifest, tools: [{ ...tool, description: 1 }] },
    { ...manifest, tools: [{ ...tool, inputSchema: [] }] },
  ]) {
    expect(() => decodeManifest(value)).toThrow("Invalid manifest");
  }
});

test("decodeManifest asks to regenerate v1 output", () => {
  expect(() => decodeManifest({ version: 1, service: "demo", commands: [] })).toThrow(UsageError);
});

test("applyCustomizations overlays plugin metadata at run time", () => {
  const resolved = applyCustomizations(
    pluginWith({ echo: { path: ["message", "echo"], examples: ["demo message echo"] } }),
    decodeManifest(manifest),
  );
  expect(resolved).toEqual({
    service: "demo",
    summary: "Demo",
    commands: [
      { ...tool, path: ["message", "echo"], summary: "Echo text", examples: ["demo message echo"] },
    ],
  });
  const unmapped = applyCustomizations(pluginWith(), generated(["toString"]));
  expect(unmapped.commands[0]?.path).toEqual(["call", "toString"]);
});

test("applyCustomizations rejects stale, reserved, invalid and conflicting paths", () => {
  const cases: Array<[Record<string, CommandCustomization>, string[]]> = [
    [{ missing: { path: ["x"] } }, ["a"]],
    [{ a: { path: ["help"] } }, ["a"]],
    [{ a: { path: ["bad path"] } }, ["a"]],
    [{ a: { path: [] } }, ["a"]],
    [{ a: { path: ["x"] }, b: { path: ["x", "y"] } }, ["a", "b"]],
    [{ a: { path: ["x"] }, b: { path: ["x"] } }, ["a", "b"]],
    [{}, ["a", "a"]],
  ];
  for (const [commands, names] of cases)
    expect(() => applyCustomizations(pluginWith(commands), generated(names))).toThrow();
  expect(() =>
    applyCustomizations(pluginWith(), { ...generated(["a"]), service: "other" }),
  ).toThrow("does not match");
});
