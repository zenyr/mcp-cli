import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import linear from "../src";
import { manifest } from "../src/generated";

test("help, methods and skill stay offline", async () => {
  const f = recordingPorts();
  for (const args of [["--help"], ["methods", "--json"], ["skill"]])
    expect(await runService(linear, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  expect(f.calls).toHaveLength(0);
});

test("flags preserve explicit nulls and sub-team filters", async () => {
  const cases = [
    {
      args: ["project", "save", "--input", '{"id":"project","targetDate":null}'],
      tool: "save_project",
      input: { id: "project", targetDate: null },
    },
    {
      args: ["issue", "list", "--team", "ENG", "--includeSubTeams"],
      tool: "list_issues",
      input: { team: "ENG", includeSubTeams: true },
    },
  ];
  for (const { args, tool, input } of cases) {
    const f = recordingPorts();
    expect(await runService(linear, manifest, args, f.ports)).toBe(0);
    expect(f.calls).toEqual([{ name: tool, input }]);
  }
});
