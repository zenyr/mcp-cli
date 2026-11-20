import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts } from "@mcp-cli/runtime/testing";
import linear from "../src";
import { manifest } from "../src/generated";

type Documented = { line: string; tool?: string };
const words = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const documented: Documented[] = [
  ...Object.entries(linear.commands ?? {}).flatMap(([tool, command]) =>
    (command.examples ?? []).map((line) => ({ line, tool })),
  ),
  ...(linear.quickstart ?? []).map(({ command }) => ({ line: `linear ${command}` })),
];

test.each(documented)("documented example runs: $line", async ({ line, tool }) => {
  const f = recordingPorts();
  expect(await runService(linear, manifest, words(line).slice(1), f.ports)).toBe(0);
  expect(f.calls.map((call) => call.name)).toEqual([tool ?? expect.any(String)]);
});
