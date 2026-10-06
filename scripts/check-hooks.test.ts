import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mcp-cli-hooks-"));
const run = async (script: string, path: string) => {
  const child = Bun.spawn(["bun", script, path], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { exitCode, stderr };
};
afterAll(async () => rm(directory, { recursive: true, force: true }));

test("requires scope and rejects malformed conventional commit subjects", async () => {
  const file = join(directory, "COMMIT_EDITMSG");
  for (const message of ["feat: missing scope", "feat(): empty scope", "random message"]) {
    await writeFile(file, message);
    expect((await run("scripts/check-commit-message.ts", file)).exitCode).toBe(1);
  }
  await writeFile(file, "feat(cli)!: change command\n\nBody");
  expect((await run("scripts/check-commit-message.ts", file)).exitCode).toBe(0);
});

test("rejects unsafe syntax and accepts arrows and method signatures", async () => {
  const file = join(directory, "sample.ts");
  await writeFile(file, "function bad(value: any) { return value! as unknown; }");
  const result = await run("scripts/check-code-rules.ts", file);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.split("\n").filter(Boolean)).toHaveLength(4);
  await writeFile(file, "interface Port { run(): void }; const run = () => 1;");
  expect((await run("scripts/check-code-rules.ts", file)).exitCode).toBe(0);
});

test("exempts generated code", async () => {
  const file = join(directory, "generated.ts");
  await writeFile(file, "function generated(value: any) { return value! as unknown; }");
  expect((await run("scripts/check-code-rules.ts", file)).exitCode).toBe(0);
});
