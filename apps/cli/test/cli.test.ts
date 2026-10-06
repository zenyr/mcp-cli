import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { generatedFiles, loadManifest, loadPlugin, registry } from "../src/plugins";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const run = async (...args: string[]) => {
  const child = Bun.spawn(["bun", "apps/cli/src/main.ts", ...args], {
    cwd: root,
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
test("registry keys match plugin names and resolve package files", async () => {
  for (const name of Object.keys(registry)) {
    expect((await loadPlugin(name)).name).toBe(name);
    expect(generatedFiles(name).module).toEndWith(`plugins/${name}/src/generated.ts`);
  }
  expect((await loadManifest("demo")).service).toBe("demo");
  await expect(loadManifest("notion")).rejects.toThrow("notion is not generated yet");
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
