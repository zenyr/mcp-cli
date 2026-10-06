import { expect, test } from "bun:test";
import { createManifest, generateModule } from "../src";
import plugin from "../../../plugins/demo/src";
import snapshot from "../../../plugins/demo/src/tools.json";

test("code generation is deterministic across tool ordering", async () => {
  const forward = createManifest(plugin, snapshot.tools);
  const reverse = createManifest(plugin, [...snapshot.tools].reverse());
  expect(await generateModule(forward)).toBe(await generateModule(reverse));
  const generated = await generateModule(forward);
  expect(generated).toContain('["demo-echo"]: (input: Tool0Input)');
  expect(generated).toContain("text: string");
});
test("unmapped tools remain callable without naming guesses", () => {
  const manifest = createManifest({ ...plugin, commands: {} }, snapshot.tools);
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

test("prototype member tool names receive fallback paths", () => {
  const manifest = createManifest({ ...plugin, commands: {} }, [
    { name: "toString", inputSchema: { type: "object" } },
  ]);
  expect(manifest.commands.at(0)?.path).toEqual(["call", "toString"]);
});
