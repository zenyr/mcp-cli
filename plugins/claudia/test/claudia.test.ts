import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import plugin from "../src";
import { manifest } from "../src/generated";

const cases = [
  { path: ["recipe", "get"], tool: "get_recipe", input: {} },
  { path: ["canon", "get"], tool: "claudia_canon", input: { detail: "looks" } },
  { path: ["kit", "get"], tool: "get_kit", input: {} },
  { path: ["guide", "get"], tool: "get_guide", input: { topic: "recipe" } },
  { path: ["film", "plan"], tool: "plan_film", input: {} },
  { path: ["film", "list"], tool: "list_films", input: {} },
  { path: ["film", "record", "get"], tool: "get_record", input: { film: "bliss", doc: "readme" } },
  { path: ["shot", "write"], tool: "write_shot", input: {} },
  { path: ["prompt", "check"], tool: "check_prompt", input: { prompt: "A singer on stage" } },
  { path: ["prompt", "build"], tool: "build_prompt", input: { scene: "A stage" } },
  { path: ["image", "search"], tool: "search_images", input: { query: "green", limit: 5 } },
  { path: ["image", "browse"], tool: "browse_images", input: {} },
  { path: ["image", "get"], tool: "get_image", input: { id: "sp-02-open.siren-mcu.2" } },
  { path: ["agent-skill", "get"], tool: "get_skill", input: {} },
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
    ["film", "--help"],
    ["film", "record", "--help"],
    ["methods", "--json"],
    ["skill"],
    ["image", "search", "--help"],
    ["schema", "prompt", "build"],
  ]) {
    expect(await runService(plugin, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  }
  expect(f.calls).toHaveLength(0);
});

test.each([
  {
    args: ["image", "search", "--query", "chroma-key 'green' $(echo test)", "--limit", "5"],
    call: { name: "search_images", input: { query: "chroma-key 'green' $(echo test)", limit: 5 } },
  },
  {
    args: ["film", "plan", "--scale", "studio", "--song-seconds", "200", "--has", '["higgsfield"]'],
    call: { name: "plan_film", input: { scale: "studio", song_seconds: 200, has: ["higgsfield"] } },
  },
  {
    args: ["canon", "get", "--detail", "looks", "--include-images"],
    call: { name: "claudia_canon", input: { detail: "looks", include_images: true } },
  },
  {
    args: ["shot", "write", "--first-frame", "a stage", "--lines", '[{"words":"la la"}]', "--mic"],
    call: {
      name: "write_shot",
      input: { first_frame: "a stage", lines: [{ words: "la la" }], mic: true },
    },
  },
  {
    args: ["film", "list", "--film", "a-film-released-after-the-snapshot"],
    call: { name: "list_films", input: { film: "a-film-released-after-the-snapshot" } },
  },
  {
    args: ["film", "record", "get", "--film", "new-film", "--doc", "new-doc"],
    call: { name: "get_record", input: { film: "new-film", doc: "new-doc" } },
  },
])("flags for $call.name reach the tool unchanged", async ({ args, call }) => {
  const f = recordingPorts();
  expect(await runService(plugin, manifest, [...args], f.ports)).toBe(0);
  expect(f.calls).toEqual([call]);
});

const words = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
const documented = [
  ...(readme.match(/```sh\n([\s\S]*?)```/)?.[1] ?? "").split("\n"),
  ...Object.values(plugin.commands ?? {}).flatMap((command) => command.examples ?? []),
].filter((line) => line.startsWith("claudia "));

test.each(documented)("documented example runs: %s", async (line) => {
  const f = recordingPorts();
  const args = words(line).slice(1);
  const flags = args
    .filter((arg) => arg.startsWith("--") && arg !== "--json")
    .map((arg) => arg.slice(2).replaceAll("-", "_"));
  expect(await runService(plugin, manifest, args, f.ports)).toBe(0);
  expect(f.calls).toHaveLength(1);
  expect(Object.keys(f.calls[0]?.input ?? {}).sort()).toEqual(flags.sort());
});

test("all public tools are mapped and retain the server's read-only annotation", () => {
  expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(
    Object.keys(plugin.commands ?? {}).sort(),
  );
  expect(manifest.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  expect(plugin.auth).toBeUndefined();
});
