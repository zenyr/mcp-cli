import { expect, test } from "bun:test";
import { applyCustomizations } from "@mcp-cli/core";
import { help, runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import fish from "../src";
import { manifest } from "../src/generated";

type Example = { path: string; tool: string; input: Record<string, unknown> };
const example = (path: string, tool: string, input: Record<string, unknown> = {}): Example => ({
  path,
  tool,
  input: { workspace_id: "workspace", ...input },
});
const uuid = "12345678-1234-4234-8234-123456789abc";
const examples: Example[] = [
  example("asset list", "list_assets", { search: "portrait", kinds: ["image"] }),
  example("asset get", "get_asset", { asset_id: "asset" }),
  example("asset save", "save_asset", { source_task_id: "task", title: "Portrait" }),
  example("asset update", "update_asset", { asset_id: "asset", collection_id: null }),
  example("asset collection list", "list_asset_collections", { all: true }),
  example("asset collection get", "get_asset_collection", { collection_id: "collection" }),
  example("asset collection update", "update_asset_collection", {
    collection_id: "collection",
    name: "References",
  }),
  example("asset folder create", "create_asset_folder", { name: "References", request_id: uuid }),
  example("asset avatar create", "create_avatar", {
    name: "Presenter",
    object_key: "portrait.png",
    request_id: uuid,
  }),
];

test.each(examples)(
  "$path forwards the same input through mapped and raw commands",
  async ({ path, tool, input }) => {
    const f = recordingPorts();
    for (const command of [path.split(" "), ["call", tool]]) {
      expect(
        await runService(fish, manifest, [...command, "--input", JSON.stringify(input)], f.ports),
      ).toBe(0);
    }
    expect(f.calls).toEqual([
      { name: tool, input },
      { name: tool, input },
    ]);
    const text = help(applyCustomizations(fish, manifest), path.split(" "));
    expect(text).toContain("Examples:");
    expect(text).not.toContain("Unknown command");
  },
);

test("help, methods and skill stay offline", async () => {
  const f = recordingPorts();
  for (const args of [["--help"], ["methods", "--json"], ["skill"]])
    expect(await runService(fish, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  expect(f.calls).toHaveLength(0);
});

test("flags preserve batches and explicit nulls", async () => {
  const cases = [
    {
      args: ["media", "job", "status", "--generation-ids", '["one","two"]'],
      tool: "get_generation_status",
      input: { generation_ids: ["one", "two"] },
    },
    {
      args: [
        "asset",
        "update",
        "--input",
        '{"workspace_id":"workspace","asset_id":"asset","collection_id":null}',
      ],
      tool: "update_asset",
      input: { workspace_id: "workspace", asset_id: "asset", collection_id: null },
    },
  ];
  for (const { args, tool, input } of cases) {
    const f = recordingPorts();
    expect(await runService(fish, manifest, args, f.ports)).toBe(0);
    expect(f.calls).toEqual([{ name: tool, input }]);
  }
});
