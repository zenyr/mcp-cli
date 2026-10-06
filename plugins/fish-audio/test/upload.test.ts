import { expect, test } from "bun:test";
import type { ToolResult } from "@mcp-cli/core";
import { uploadFile } from "../src/upload";

const file = { path: "./a.wav", name: "a.wav", bytes: new Uint8Array([1, 2]) };
const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: value }],
  isError,
});
const context = (result: ToolResult) => {
  const calls: unknown[] = [];
  const puts: Array<[string, number[]]> = [];
  return {
    calls,
    puts,
    ports: {
      callTool: async (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return result;
      },
      putBytes: async (url: string, bytes: Uint8Array) => {
        puts.push([url, [...bytes]]);
      },
    },
  };
};

test("uploadFile requests a slot, puts the bytes and returns the file URL", async () => {
  const slot = { upload_url: "https://put", file_url: "https://get", storage_key: "k" };
  const { calls, puts, ports } = context(text(JSON.stringify(slot)));
  expect(await uploadFile(file, ports)).toBe("https://get");
  expect(calls).toEqual([{ name: "get_upload_url", input: { filename: "a.wav" } }]);
  expect(puts).toEqual([["https://put", [1, 2]]]);
});

test("uploadFile fails on tool errors and malformed slots without putting bytes", async () => {
  for (const [result, message] of [
    [text("quota exceeded", true), "get_upload_url failed: quota exceeded"],
    [text("not json"), "no upload_url"],
    [text('{"upload_url":"https://put"}'), "no upload_url"],
  ] as const) {
    const { puts, ports } = context(result);
    await expect(uploadFile(file, ports)).rejects.toThrow(message);
    expect(puts).toEqual([]);
  }
});
