import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NotGeneratedError, UsageError } from "@mcp-cli/core";
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
  MCP_CLI_CONFIG: "",
};
const run = async (...args: string[]) => {
  const child = Bun.spawn(["bun", "apps/cli/src/main.ts", ...args], {
    cwd: root,
    env: isolatedEnv,
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
  for (const name of ["demo", "notion"]) {
    const plugin = findPlugin(registry, name);
    expect((await loadPlugin(plugin)).name).toBe(name);
    expect(packageFiles(plugin).module).toEndWith(`plugins/${name}/src/generated.ts`);
  }
  expect((await loadManifest(registry, findPlugin(registry, "demo"))).service).toBe("demo");
  await expect(loadManifest(registry, findPlugin(registry, "notion"))).rejects.toThrow(
    NotGeneratedError,
  );
});
test("plugins lists discovered services with generated status", async () => {
  const listing = await run("plugins");
  expect(listing.code).toBe(0);
  expect(listing.stdout).toMatch(/demo\s+workspace\s+generated \(package\)/);
  expect(listing.stdout).toMatch(/notion\s+workspace\s+not generated/);
  expect((await run("plugins", "extra")).code).toBe(2);
});
test("missing and outdated generated code share the failure exit status", () => {
  expect(exitCodeFor(new NotGeneratedError("missing"))).toBe(EXIT.failure);
  expect(exitCodeFor(new UsageError("usage"))).toBe(EXIT.usage);
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
