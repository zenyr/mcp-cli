import { expect, test } from "bun:test";
import { runService } from "@mcp-cli/runtime";
import { recordingPorts } from "@mcp-cli/runtime/testing";
import notion from "../src";
import { manifest } from "../src/generated";

type Documented = { line: string; tool?: string };
const words = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
const documented: Documented[] = [
  ...Object.entries(notion.commands ?? {}).flatMap(([tool, command]) =>
    (command.examples ?? []).map((line) => ({ line, tool })),
  ),
  ...(notion.quickstart ?? []).map(({ command }) => ({ line: `notion ${command}` })),
];
const fromFile = ({ line }: Documented): boolean => line.includes("--input-file");

test.each(documented.filter((entry) => !fromFile(entry)))(
  "documented example runs: $line",
  async ({ line, tool }) => {
    const f = recordingPorts();
    expect(await runService(notion, manifest, words(line).slice(1), f.ports)).toBe(0);
    expect(f.calls.map((call) => call.name)).toEqual([tool ?? expect.any(String)]);
  },
);

test.each(documented.filter(fromFile))(
  "documented example reaches its input file: $line",
  async ({ line }) => {
    const f = recordingPorts();
    const args = words(line).slice(1);
    const reads: string[] = [];
    const absent = new Error("example input file is not part of the test");
    const readFile = async (path: string): Promise<never> => {
      reads.push(path);
      throw absent;
    };
    const ports = { ...f.ports, io: { ...f.ports.io, readFile } };
    await expect(runService(notion, manifest, args, ports)).rejects.toBe(absent);
    expect(reads).toEqual([args[args.indexOf("--input-file") + 1]]);
    expect(f.calls).toHaveLength(0);
  },
);
