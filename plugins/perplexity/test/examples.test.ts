import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts } from "@mcp-cli/runtime/testing";
import pplx from "../src";
import { manifest } from "../src/generated";

type Documented = { line: string; tool?: string };
const words = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
const documented: Documented[] = [
  ...(readme.match(/```sh\n([\s\S]*?)```/)?.[1] ?? "")
    .split("\n")
    .filter((line) => line.startsWith("pplx "))
    .map((line) => ({ line })),
  ...Object.entries(pplx.commands ?? {}).flatMap(([tool, command]) =>
    (command.examples ?? []).map((line) => ({ line, tool })),
  ),
  ...(pplx.quickstart ?? []).map(({ command }) => ({ line: `pplx ${command}` })),
];

test.each(documented)("documented example runs: $line", async ({ line, tool }) => {
  const f = recordingPorts();
  expect(await runService(pplx, manifest, words(line).slice(1), f.ports)).toBe(0);
  expect(f.calls.map((call) => call.name)).toEqual([tool ?? expect.any(String)]);
});
