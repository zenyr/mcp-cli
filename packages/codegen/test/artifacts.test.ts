import { expect, test } from "bun:test";
import { buildArtifacts, decodeSnapshot, isCurrent } from "../src";
import plugin from "./fixtures/plugin";
import snapshot from "./fixtures/tools.json";

const tools = decodeSnapshot(snapshot);

test("artifacts do not depend on tool order", async () => {
  const forward = await buildArtifacts(plugin, tools);
  const reverse = await buildArtifacts(plugin, [...tools].reverse());
  expect(reverse).toEqual(forward);
  expect(forward.snapshot).toEndWith("\n");
  expect(JSON.parse(forward.snapshot).tools.map((tool: { name: string }) => tool.name)).toEqual(
    tools.map((tool) => tool.name).sort(),
  );
});
test("an empty tool list fails", async () => {
  await expect(buildArtifacts(plugin, [])).rejects.toThrow("fixture returned no tools");
});
test("snapshots without a tools array fail to decode", () => {
  expect(() => decodeSnapshot({})).toThrow("Snapshot must contain a tools array");
  expect(() => decodeSnapshot([])).toThrow("Snapshot must contain a tools array");
});
test("the snapshot compares as data and the module as text", async () => {
  const built = await buildArtifacts(plugin, tools);
  const reformatted = JSON.stringify(JSON.parse(built.snapshot));
  expect(isCurrent(built, built)).toBe(true);
  expect(isCurrent({ ...built, snapshot: reformatted }, built)).toBe(true);
  expect(isCurrent({ ...built, module: `${built.module}\n` }, built)).toBe(false);
  expect(isCurrent({ ...built, snapshot: JSON.stringify({ tools: [] }) }, built)).toBe(false);
  expect(isCurrent({ module: built.module }, built)).toBe(false);
  expect(isCurrent({ snapshot: built.snapshot }, built)).toBe(false);
});
