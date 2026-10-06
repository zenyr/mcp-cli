import { expect, test } from "bun:test";
import { decodeManifest } from "../src/index";

const command = { name: "echo", path: ["message", "echo"], inputSchema: { type: "object" } };
const manifest = { version: 1, service: "demo", summary: "Demo", commands: [command] };

test("decodeManifest accepts a generated manifest and keeps optional fields", () => {
  const decoded = decodeManifest({
    ...manifest,
    commands: [{ ...command, summary: "Echo", examples: ["demo message echo"] }],
  });
  expect(decoded.commands[0]?.examples).toEqual(["demo message echo"]);
});

test("decodeManifest rejects malformed manifests", () => {
  for (const value of [
    null,
    { ...manifest, version: 2 },
    { ...manifest, service: "" },
    { ...manifest, summary: 1 },
    { ...manifest, commands: {} },
    { ...manifest, commands: [{ ...command, name: 1 }] },
    { ...manifest, commands: [{ ...command, path: [] }] },
    { ...manifest, commands: [{ ...command, inputSchema: [] }] },
    { ...manifest, commands: [{ ...command, examples: "x" }] },
  ]) {
    expect(() => decodeManifest(value)).toThrow("Invalid manifest");
  }
});
