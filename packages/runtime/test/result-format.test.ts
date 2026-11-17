import { expect, test } from "bun:test";
import { definePlugin } from "@mcp-cli/core";
import { runService } from "../src";
import { catalogStub, commands, manifest } from "./fixtures/manifest";

test("plugin formatting covers named and raw calls while JSON preserves the envelope", async () => {
  const result = { content: [{ type: "text", text: "original" }], isError: false };
  let formats = 0;
  let closed = 0;
  const plugin = definePlugin({
    name: "demo",
    summary: "Demo",
    commands,
    connection: () => ({ type: "stdio", command: "unused" }),
    formatResult: () => {
      formats++;
      return "compact";
    },
  });
  const output: string[] = [];
  const dependencies = {
    open: async () => ({
      ...catalogStub,
      listTools: async () => [],
      callTool: async () => result,
      close: async () => {
        closed++;
      },
    }),
    io: {
      write: (text: string) => output.push(text),
      writeError: (text: string) => output.push(text),
      readFile: async () => "",
      readBytes: async () => new Uint8Array(),
      readStdin: async () => "",
    },
  };
  for (const path of [
    ["message", "echo"],
    ["call", "demo-echo"],
  ]) {
    expect(await runService(plugin, manifest, [...path, "--text", "x"], dependencies)).toBe(0);
    expect(output.pop()).toBe("compact");
    expect(
      await runService(plugin, manifest, [...path, "--text", "x", "--json"], dependencies),
    ).toBe(0);
    expect(JSON.parse(output.pop() ?? "")).toEqual(result);
  }
  expect(formats).toBe(2);
  expect(closed).toBe(4);
  expect(
    await runService(
      { ...plugin, formatResult: () => undefined },
      manifest,
      ["message", "echo", "--text", "x"],
      dependencies,
    ),
  ).toBe(0);
  expect(output.pop()).toBe("original");
  expect(
    await runService(
      { ...plugin, formatResult: (value, hostFormat) => `${hostFormat(value)}\nextra` },
      manifest,
      ["message", "echo", "--text", "x"],
      dependencies,
    ),
  ).toBe(0);
  expect(output.pop()).toBe("original\nextra");
});
