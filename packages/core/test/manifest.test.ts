import { expect, test } from "bun:test";
import {
  NotGeneratedError,
  UsageError,
  applyCustomizations,
  decodeAnnotations,
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

test("annotations keep known MCP hints and drop unknown or mistyped fields", () => {
  const annotations = { readOnlyHint: true, idempotentHint: false, title: "Echo" };
  const decoded = decodeManifest({
    ...manifest,
    tools: [{ ...tool, annotations: { ...annotations, destructiveHint: "yes", extra: 1 } }],
  });
  expect(decoded.tools[0]?.annotations).toEqual(annotations);
  for (const value of [undefined, null, [], {}, { readOnlyHint: "true" }])
    expect(decodeAnnotations(value)).toBeUndefined();
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

test("decodeManifest asks to regenerate v1 output with a not-generated error", () => {
  const decode = () => decodeManifest({ version: 1, service: "demo", commands: [] });
  expect(decode).toThrow(NotGeneratedError);
  expect(decode).not.toThrow(UsageError);
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
    groups: {},
    quickstart: [],
  });
  const unmapped = applyCustomizations(pluginWith(), generated(["toString"]));
  expect(unmapped.commands[0]?.path).toEqual(["call", "toString"]);
});

test("fallback paths accept MCP tool names with dots and slashes", () => {
  const resolved = applyCustomizations(pluginWith(), generated(["files.read", "repo/list"]));
  expect(resolved.commands.map((command) => command.path)).toEqual([
    ["call", "files.read"],
    ["call", "repo/list"],
  ]);
  for (const path of [["files.read"], ["repo/list"], ["x", "a.b"]])
    expect(() => applyCustomizations(pluginWith({ a: { path } }), generated(["a"]))).toThrow(
      "Invalid command path",
    );
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

test("applyCustomizations validates group descriptions and quickstart commands", () => {
  const commands = { a: { path: ["media", "image", "create"] } };
  const withMetadata = (groups: Record<string, string>, quickstart: string[]) =>
    applyCustomizations(
      {
        ...pluginWith(commands),
        groups,
        quickstart: quickstart.map((command) => ({ command, summary: "Try it" })),
      },
      generated(["a"]),
    );
  const resolved = withMetadata({ media: "Media", "media image": "Images" }, [
    "media image create --prompt cat",
    "media",
    "methods --json",
  ]);
  expect(resolved.groups).toEqual({ media: "Media", "media image": "Images" });
  expect(resolved.quickstart).toHaveLength(3);
  for (const group of ["video", "media image create", "image"])
    expect(() => withMetadata({ [group]: "x" }, [])).toThrow("missing command group");
  for (const command of ["media video", "media image create extra", "--json", ""])
    expect(() => withMetadata({}, [command])).toThrow("missing command");
});

test("upload fields need an uploader and a string or string-array schema", () => {
  const tool = {
    name: "a",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        urls: { type: "array", items: { type: "string" } },
        count: { type: "integer" },
      },
    },
  };
  const manifest: GeneratedManifest = { version: 2, service: "demo", tools: [tool] };
  const withUploads = (uploads: string[], uploader = true) =>
    applyCustomizations(
      {
        ...pluginWith({ a: { path: ["x", "y"], uploads } }),
        ...(uploader && { uploadFile: async () => "https://example.com/f" }),
      },
      manifest,
    );
  expect(withUploads(["url", "urls"]).commands[0]?.uploads).toEqual(["url", "urls"]);
  expect(() => withUploads(["url"], false)).toThrow("without uploadFile");
  for (const field of ["count", "missing", "toString"])
    expect(() => withUploads([field])).toThrow("Invalid upload field");
});

test("optional mappings tolerate tools the server omits and prune their help metadata", () => {
  const plugin = {
    ...pluginWith({
      read: { path: ["channel", "read"] },
      send: { path: ["message", "send"], optional: true },
    }),
    groups: { channel: "Read", message: "Send" },
    quickstart: [
      { command: "channel read --id x", summary: "Read" },
      { command: "message send --text hi", summary: "Send" },
      { command: "call send", summary: "Raw send" },
    ],
  };
  const resolved = applyCustomizations(plugin, generated(["read"]));
  expect(resolved.groups).toEqual({ channel: "Read" });
  expect(resolved.quickstart.map((entry) => entry.command)).toEqual(["channel read --id x"]);
  expect(applyCustomizations(plugin, generated(["read", "send"])).quickstart).toHaveLength(3);
  expect(() =>
    applyCustomizations(pluginWith({ send: { path: ["message", "send"] } }), generated(["read"])),
  ).toThrow("missing tool: send");
  expect(() =>
    applyCustomizations({ ...plugin, groups: { video: "x" } }, generated(["read"])),
  ).toThrow("missing command group");
});

test("quickstart call entries must name a known tool", () => {
  const withQuickstart = (command: string) =>
    applyCustomizations(
      { ...pluginWith(), quickstart: [{ command, summary: "Try" }] },
      generated(["echo"]),
    );
  expect(withQuickstart("call echo --text hi").quickstart).toHaveLength(1);
  expect(withQuickstart("methods").quickstart).toHaveLength(1);
  expect(() => withQuickstart("call missing")).toThrow("missing command: call missing");
});
