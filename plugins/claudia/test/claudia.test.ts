import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import plugin from "../src";
import { manifest } from "../src/generated";

const cases = [
  { path: ["recipe"], tool: "get_recipe", input: {} },
  { path: ["canon"], tool: "claudia_canon", input: { detail: "looks" } },
  { path: ["film", "plan"], tool: "plan_film", input: {} },
  { path: ["film", "list"], tool: "list_films", input: {} },
  { path: ["kit"], tool: "get_kit", input: {} },
  { path: ["shot", "write"], tool: "write_shot", input: {} },
  { path: ["prompt", "check"], tool: "check_prompt", input: { prompt: "A singer on stage" } },
  { path: ["prompt", "build"], tool: "build_prompt", input: { scene: "A stage" } },
  { path: ["guide"], tool: "get_guide", input: { topic: "recipe" } },
  { path: ["record"], tool: "get_record", input: { film: "bliss", doc: "readme" } },
  { path: ["image", "search"], tool: "search_images", input: { query: "green", limit: 5 } },
  { path: ["image", "browse"], tool: "browse_images", input: {} },
  { path: ["image", "get"], tool: "get_image", input: { id: "sp-02-open.siren-mcu.2" } },
  { path: ["agent-skill"], tool: "get_skill", input: {} },
];

test.each(cases)(
  "$tool preserves input through mapped and raw commands",
  async ({ path, tool, input }) => {
    const f = recordingPorts();
    for (const command of [path, ["call", tool]]) {
      expect(
        await runService(plugin, manifest, [...command, "--input", JSON.stringify(input)], f.ports),
      ).toBe(0);
    }
    expect(f.calls).toEqual([
      { name: tool, input },
      { name: tool, input },
    ]);
  },
);

test("discovery and help work without connecting to the server", async () => {
  const f = recordingPorts();
  for (const args of [
    ["--help"],
    ["methods", "--json"],
    ["skill"],
    ["image", "search", "--help"],
    ["schema", "prompt", "build"],
  ]) {
    expect(await runService(plugin, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  }
  expect(f.calls).toHaveLength(0);
});

test("search flags retain numbers and literal query text", async () => {
  const f = recordingPorts();
  const query = "chroma-key 'green' $(echo test)";
  expect(
    await runService(
      plugin,
      manifest,
      ["image", "search", "--query", query, "--limit", "5"],
      f.ports,
    ),
  ).toBe(0);
  expect(f.calls).toEqual([{ name: "search_images", input: { query, limit: 5 } }]);
});

test("all public tools are mapped and retain the server's read-only annotation", () => {
  expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(
    Object.keys(plugin.commands ?? {}).sort(),
  );
  expect(manifest.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  expect(plugin.connection({})).toEqual({ type: "http", url: "https://claudia.gallery/mcp" });
  expect(plugin.auth).toBeUndefined();
});
