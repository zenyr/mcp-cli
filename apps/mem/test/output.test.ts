import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { main } from "../src/main";
import { isRecord } from "../src/values";

const directories: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "mem-yaml-"));
  directories.push(directory);
  const run = async (args: string[]) => {
    let stdout = "";
    const code = await main(args, {
      cwd: directory,
      env: {
        HOME: directory,
        XDG_DATA_HOME: join(directory, "data"),
        XDG_CONFIG_HOME: join(directory, "config"),
      },
      compress: async () => ({ text: "요약", model: "fixture", inputTokens: 1, outputTokens: 1 }),
      io: {
        write: (text) => {
          stdout += text;
        },
        readFile: async () => "",
        readStdin: async () => "",
      },
    });
    const value: unknown = args.includes("--json") ? JSON.parse(stdout) : parseYaml(stdout);
    if (!isRecord(value)) throw new Error("Expected a response object");
    return { code, stdout, value };
  };
  return { run, directory };
};
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("CLI defaults to multiline YAML and explicit JSON preserves response values", async () => {
  const { run } = fixture();
  const yaml = await run(["status", "--global"]);
  const json = await run(["status", "--global", "--json"]);
  expect(yaml.code).toBe(0);
  expect(yaml.stdout).toStartWith("ok: true\n");
  expect(yaml.stdout).toContain("\nscopes:\n");
  expect(yaml.value).toEqual(json.value);
  expect(json.stdout).toStartWith('{"ok":true,');
  for (const jsonFlag of [[], ["--json"]]) {
    const invalid = await run(["status", "--unknown", ...jsonFlag]);
    expect(invalid.code).toBe(2);
    expect(invalid.value.error).toMatchObject({ code: "INVALID_OPTION" });
  }
  expect((await run(["status", "--json", "--json"])).code).toBe(2);
});

test("multiline record output uses literal YAML and preserves ambiguous strings", async () => {
  const { run } = fixture();
  const text = "yes\n2026-11-23\nnull\n# heading\nkey: value\n한국어 😀\n\n";
  expect((await run(["save", text, "--global"])).code).toBe(0);
  const page = await run(["read", "global/0", "--global"]);
  expect(page.stdout).toContain("text: |+\n");
  expect(page.value.text).toBe(text);
  expect(page.value).toEqual((await run(["read", "global/0", "--global", "--json"])).value);
});

test("YAML read and leaf zoom pages preserve all text within the UTF-8 response budget", async () => {
  const { run } = fixture();
  const text = '한국어 😀\n  들여쓰기\n"yes": null\\\n'.repeat(70);
  expect((await run(["save", text, "--global"])).code).toBe(0);
  const packet = await run(["start", "--global"]);
  const generation = packet.value.generation;
  if (typeof generation !== "string") throw new Error("Missing generation");
  for (const command of ["read", "zoom"]) {
    let cursor: string | undefined;
    let reconstructed = "";
    do {
      const args = [command, "global/0", "--global", "--max-bytes", "512"];
      if (command === "zoom") args.push("--count", "1", "--generation", generation);
      if (cursor) args.push("--cursor", cursor);
      const page = await run(args);
      expect(page.code).toBe(0);
      expect(Buffer.byteLength(page.stdout)).toBeLessThanOrEqual(512);
      if (typeof page.value.text !== "string") throw new Error("Missing text");
      reconstructed += page.value.text;
      cursor = typeof page.value.cursor === "string" ? page.value.cursor : undefined;
    } while (cursor);
    expect(reconstructed).toBe(text);
  }
});

test("YAML recall paging keeps every match and startup merges ranges to fit the budget", async () => {
  const { run } = fixture();
  for (let i = 0; i < 8; i++)
    expect((await run(["save", `MATCH ${i}\n${"기록 ".repeat(30)}`, "--global"])).code).toBe(0);
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const args = ["recall", "MATCH", "--global", "--max-bytes", "512"];
    if (cursor) args.push("--cursor", cursor);
    const page = await run(args);
    expect(page.code).toBe(0);
    expect(Buffer.byteLength(page.stdout)).toBeLessThanOrEqual(512);
    if (!Array.isArray(page.value.results)) throw new Error("Missing results");
    for (const item of page.value.results) {
      if (!isRecord(item) || typeof item.recordId !== "string") throw new Error("Invalid result");
      ids.push(item.recordId);
    }
    cursor = typeof page.value.cursor === "string" ? page.value.cursor : undefined;
  } while (cursor);
  expect(new Set(ids).size).toBe(8);
  const packet = await run(["start", "--global", "--max-bytes", "512"]);
  expect(packet.code).toBe(0);
  expect(Buffer.byteLength(packet.stdout)).toBeLessThanOrEqual(512);
  const scopes = packet.value.scopes;
  if (!Array.isArray(scopes) || !isRecord(scopes[0]) || !Array.isArray(scopes[0].view))
    throw new Error("Missing scopes");
  let covered = 0;
  for (const range of scopes[0].view) {
    if (!isRecord(range) || typeof range.count !== "number") throw new Error("Invalid range");
    covered += range.count;
  }
  expect(covered).toBe(8);
});

test("default YAML priming includes both global and current project memory", async () => {
  const { run, directory } = fixture();
  const git = Bun.spawn(["git", "-C", directory, "init"], { stdout: "ignore", stderr: "ignore" });
  expect(await git.exited).toBe(0);
  expect((await run(["save", "Global preference", "--global", "--kind", "user"])).code).toBe(0);
  expect((await run(["save", "Project decision"])).code).toBe(0);
  const packet = await run(["start"]);
  expect(packet.code).toBe(0);
  const scopes = packet.value.scopes;
  if (!Array.isArray(scopes)) throw new Error("Missing scopes");
  expect(scopes.map((scope) => (isRecord(scope) ? scope.kind : undefined))).toEqual([
    "global",
    "project",
  ]);
  expect(packet.stdout).toContain("Global preference");
  expect(packet.stdout).toContain("Project decision");
});
