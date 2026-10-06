import { expect, test } from "bun:test";
const root = new URL("../../../", import.meta.url).pathname;
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
  expect((await run("demo", "message", "fail")).code).toBe(1);
  expect((await run("demo", "missing")).code).toBe(1);
});
test("prototype service names are rejected", async () => {
  expect((await run("constructor")).code).toBe(1);
  expect((await run("__proto__")).code).toBe(1);
});
test("generation rejects malformed and repeated options", async () => {
  for (const args of [
    ["demo", "--snapshot"],
    ["demo", "--check", "--check"],
    ["demo", "--snapshot", "x", "--snapshot", "y"],
  ]) {
    expect((await run("generate", ...args)).code).toBe(1);
  }
});
