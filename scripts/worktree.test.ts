import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanTargets, isLinkedWorktree, linksHere, run } from "./worktree";

const base = await mkdtemp(join(tmpdir(), "mcp-cli-worktree-"));
afterAll(() => rm(base, { recursive: true, force: true }));
const sh = (cwd: string, ...args: string[]) =>
  Bun.spawn(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd }).exited;

const repo = join(base, "repo");
await mkdir(join(repo, "packages", "a"), { recursive: true });
await writeFile(join(repo, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
await writeFile(join(repo, "packages", "a", "package.json"), "{}");
await writeFile(join(repo, ".gitignore"), "node_modules/\n.turbo/\n");
await sh(repo, "init", "-q");
await sh(repo, "add", ".");
await sh(repo, "commit", "-qm", "init");
for (const dir of [
  "node_modules",
  "packages/a/node_modules",
  "packages/a/.turbo",
  "packages/a/dist",
])
  await mkdir(join(repo, dir), { recursive: true });

test("clean targets only git-ignored artifacts in the root and workspaces", async () => {
  expect(await cleanTargets(repo)).toEqual([
    join(repo, "node_modules"),
    join(repo, "packages", "a", "node_modules"),
    join(repo, "packages", "a", ".turbo"),
  ]);
});

test("linked worktrees are told apart from the main checkout", async () => {
  const linked = join(base, "linked");
  await sh(repo, "worktree", "add", "-q", linked);
  expect(await isLinkedWorktree(repo)).toBe(false);
  expect(await isLinkedWorktree(linked)).toBe(true);
});

test("clean refuses the main checkout unless forced and honours dry runs", async () => {
  const lines: string[] = [];
  const context = {
    root: repo,
    force: false,
    dryRun: true,
    log: (line: string) => lines.push(line),
  };
  await expect(run("clean", context)).rejects.toThrow("main checkout");
  await run("clean", { ...context, force: true });
  expect(lines).toContain("remove node_modules");
  expect(await cleanTargets(repo)).toHaveLength(3);
});

test("a global link is recognised only when it resolves to this tree", async () => {
  const link = join(base, "link");
  await symlink(repo, link);
  expect(await linksHere(repo, link)).toBe(true);
  expect(await linksHere(join(base, "linked"), link)).toBe(false);
});
