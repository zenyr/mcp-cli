import { expect, test } from "bun:test";
import { UsageError } from "@mcp-cli/core";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import plugin from "../src";
import { manifest } from "../src/generated";

test("OAuth uses the official Suno endpoint", async () => {
  expect(plugin.auth).toEqual({ type: "oauth" });
  expect(await plugin.connection({})).toEqual({ type: "http", url: "https://api.suno.com/mcp" });
});

const cases = [
  { path: ["account", "usage"], tool: "account-usage", input: {} },
  { path: ["library", "search"], tool: "library-search", input: { query: "jazz", limit: 5 } },
  {
    path: ["audio", "create"],
    tool: "audio-create",
    input: { description: "Jazz", instrumental: true, idempotency_key: "test-creation" },
  },
  {
    path: ["audio", "cover", "create"],
    tool: "audio-covers-create",
    input: { id: "clip-1", style: "jazz", controls: { weirdness: 0.2 } },
  },
  {
    path: ["audio", "download"],
    tool: "audio-download",
    input: { id: "clip-1", confirm: true, format: "wav" },
  },
  { path: ["audio", "wait"], tool: "audio-wait", input: { id: "clip-1" } },
  {
    path: ["playlist", "add-clips"],
    tool: "playlists-add-clips",
    input: { id: "list-1", clip_ids: ["clip-1"] },
  },
  { path: ["video", "create"], tool: "video-create", input: { prompt: "Ocean", dry_run: true } },
];

test.each(cases)("$tool preserves mapped and raw inputs", async ({ path, tool, input }) => {
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
});

test("every tool has a unique mapping and offline help", async () => {
  const f = recordingPorts();
  expect(Object.keys(plugin.commands ?? {}).sort()).toEqual(
    manifest.tools.map((tool) => tool.name).sort(),
  );
  const paths = Object.values(plugin.commands ?? {}).map((command) => command.path);
  expect(new Set(paths.map((path) => path?.join(" "))).size).toBe(manifest.tools.length);
  for (const path of [[], ["methods"], ["skill"], ...paths]) {
    expect(
      await runService(plugin, manifest, [...(path ?? []), "--help"], {
        ...f.ports,
        open: unavailable,
      }),
    ).toBe(0);
  }
  expect(f.calls).toHaveLength(0);
});

test("invalid generation controls do not reach Suno", async () => {
  const f = recordingPorts();
  await expect(
    runService(
      plugin,
      manifest,
      ["audio", "create", "--input", JSON.stringify({ style: "jazz", controls: { weirdness: 2 } })],
      f.ports,
    ),
  ).rejects.toBeInstanceOf(UsageError);
  expect(f.calls).toHaveLength(0);
});
