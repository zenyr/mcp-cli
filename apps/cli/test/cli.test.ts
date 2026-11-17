import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NotGeneratedError, RepeatedCallError, UsageError } from "@mcp-cli/core";
import { EXIT, exitCodeFor } from "../src/main";
import { discover, findPlugin, loadPlugin } from "../src/discovery";
import { defaultContext } from "../src/paths";
import { loadManifest, packageFiles } from "../src/plugins";
const root = fileURLToPath(new URL("../../../", import.meta.url));
// Points config and cache lookups away from the real home directory.
const sandbox = mkdtempSync(join(tmpdir(), "mcp-cli-test-"));
const isolatedEnv = {
  ...process.env,
  HOME: "/nonexistent-home",
  XDG_CONFIG_HOME: join(sandbox, "config"),
  XDG_CACHE_HOME: join(sandbox, "cache"),
  XDG_STATE_HOME: join(sandbox, "state"),
  MCP_CLI_CONFIG: "",
  MCP_CLI_DAEMON: "0",
};
const runWith = async (env: Record<string, string>, ...args: string[]) => {
  const child = Bun.spawn(["bun", "apps/cli/src/main.ts", ...args], {
    cwd: root,
    env: { ...isolatedEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
};
const run = (...args: string[]) => runWith({}, ...args);
test("CLI generates from MCP and checks the frozen snapshot", async () => {
  expect((await run("generate", "demo", "--check")).code).toBe(0);
  expect(
    (await run("generate", "demo", "--snapshot", "plugins/demo/src/tools.json", "--check")).code,
  ).toBe(0);
});
test("CLI help, execution and error exit status", async () => {
  const help = await run("demo", "message", "echo", "--help");
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("Arguments:");
  const call = await run("demo", "message", "echo", "--text", "hello", "--uppercase");
  expect(call).toEqual({ stdout: "HELLO\n", stderr: "", code: 0 });
  const failure = await run("demo", "message", "fail");
  expect(failure.code).toBe(1);
  expect(failure.stdout).toBe("");
  expect(failure.stderr).not.toBe("");
  expect((await run("demo", "missing")).code).toBe(2);
  expect((await run("demo", "message", "echo", "--count", "x")).code).toBe(2);
});
test("unknown and prototype service names are usage errors", async () => {
  expect((await run("unknown-service")).code).toBe(2);
  expect((await run("constructor")).code).toBe(2);
  expect((await run("__proto__")).code).toBe(2);
});
test("discovered services match plugin names and resolve package files", async () => {
  const registry = await discover(await defaultContext({ HOME: "/nonexistent-home" }));
  const plugin = findPlugin(registry, "demo");
  expect((await loadPlugin(plugin)).name).toBe("demo");
  expect(packageFiles(plugin).module).toEndWith("plugins/demo/src/generated.ts");
  expect((await loadManifest(registry, findPlugin(registry, "demo"))).service).toBe("demo");
});
test("plugins lists discovered services with generated status", async () => {
  const listing = await run("plugins");
  expect(listing.code).toBe(0);
  expect(listing.stdout).toMatch(/demo\s+workspace\s+generated \(package\)/);
  expect((await run("plugins", "extra")).code).toBe(2);
});
test("missing and outdated generated code share the failure exit status", () => {
  expect(exitCodeFor(new NotGeneratedError("missing"))).toBe(EXIT.failure);
  expect(exitCodeFor(new UsageError("usage"))).toBe(EXIT.usage);
  expect(exitCodeFor(new RepeatedCallError("repeat"))).toBe(EXIT.repeated);
  expect(exitCodeFor(new Error("other"))).toBe(EXIT.failure);
});
test("generation rejects malformed and repeated options", async () => {
  for (const args of [
    ["demo", "--snapshot"],
    ["demo", "--check", "--check"],
    ["demo", "--snapshot", "x", "--snapshot", "y"],
  ]) {
    expect((await run("generate", ...args)).code).toBe(2);
  }
});

test("a repeated identical call exits 3 until --allow-repeat or a zero window", async () => {
  const args = ["demo", "message", "echo", "--text", "repeat-check"];
  expect((await run(...args)).code).toBe(0);
  const repeated = await run(...args);
  expect(repeated.code).toBe(EXIT.repeated);
  expect(repeated.stdout).toBe("");
  expect(repeated.stderr).toContain("--allow-repeat");
  expect((await run(...args, "--allow-repeat")).code).toBe(0);
  expect((await runWith({ MCP_CLI_REPEAT_WINDOW: "0" }, ...args)).code).toBe(0);
  expect((await runWith({ MCP_CLI_REPEAT_WINDOW: "-1" }, ...args)).code).toBe(EXIT.usage);
});

test("default daemon falls back before dispatch and explicit zero runs directly", async () => {
  const daemonEnv = {
    MCP_CLI_DAEMON: "",
    MCP_CLI_DAEMON_DIR: join(sandbox, "missing-daemon"),
    MCP_CLI_REPEAT_WINDOW: "0",
  };
  const args = ["demo", "message", "echo", "--text", "daemon-default-check"];
  const expected = { stdout: "daemon-default-check\n", stderr: "", code: EXIT.ok };
  expect(await runWith(daemonEnv, ...args)).toEqual(expected);
  expect(await runWith({ ...daemonEnv, MCP_CLI_DAEMON: "1" }, ...args)).toEqual(expected);
  expect(await runWith({ ...daemonEnv, MCP_CLI_DAEMON: "0" }, ...args)).toEqual(expected);
  expect((await runWith({ ...daemonEnv, MCP_CLI_DAEMON: "invalid" }, ...args)).code).toBe(
    EXIT.usage,
  );
  expect((await runWith(daemonEnv, "demo", "--help")).code).toBe(EXIT.ok);
});

test("CLI defaults JSON tool text and schemas to YAML with a global JSON override", async () => {
  const text = '{"message":"first\\nsecond","ok":true}';
  const yaml = await run("demo", "message", "echo", "--text", text);
  expect(yaml).toEqual({
    stdout: "message: |-\n  first\n  second\nok: true\n",
    stderr: "",
    code: 0,
  });
  for (const args of [
    ["--json", "demo", "message", "echo", "--text", text],
    ["demo", "message", "echo", "--text", text, "--json"],
  ]) {
    const result = await run(...args, "--allow-repeat");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveProperty("content.0.text", text);
  }
  const schema = await run("demo", "schema", "message", "echo");
  expect(schema.code).toBe(0);
  expect(schema.stdout).toStartWith("path:\n");
  const jsonSchema = await run("demo", "schema", "message", "echo", "--json");
  expect(JSON.parse(jsonSchema.stdout)).toHaveProperty("inputSchema");
});
