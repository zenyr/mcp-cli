import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts, unavailable } from "@mcp-cli/runtime/testing";
import slack from "../src";
import { manifest } from "../src/generated";

test("help, methods and skill stay offline", async () => {
  const f = recordingPorts();
  for (const args of [["--help"], ["methods", "--json"], ["skill"]])
    expect(await runService(slack, manifest, args, { ...f.ports, open: unavailable })).toBe(0);
  expect(f.calls).toHaveLength(0);
});
