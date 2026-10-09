import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths, resolveScopes } from "../src/paths";
import { loadSettings } from "../src/settings";

const directories: string[] = [];
const temporary = async () => {
  const path = await mkdtemp(join(tmpdir(), "mem-paths-"));
  directories.push(path);
  return path;
};
const git = async (cwd: string, args: string[]) => {
  const process = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, , stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(stderr);
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("absolute XDG paths override HOME and relative paths fall back", () => {
  expect(
    resolvePaths({ HOME: "/home/example", XDG_CONFIG_HOME: "relative", XDG_DATA_HOME: "relative" }),
  ).toEqual({
    configFile: "/home/example/.config/mem/config.json",
    databaseFile: "/home/example/.local/share/mem/memory.sqlite",
  });
  expect(
    resolvePaths({ HOME: "/home/example", XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data" }),
  ).toEqual({ configFile: "/config/mem/config.json", databaseFile: "/data/mem/memory.sqlite" });
});

test("non-Git directories and bare repositories require a worktree", async () => {
  const path = await temporary();
  expect(await resolveScopes(path, "both", false)).toEqual([
    { id: "global", name: "global", kind: "global" },
  ]);
  await expect(resolveScopes(path, "project", true)).rejects.toMatchObject({
    code: "PROJECT_REQUIRED",
  });
  await git(path, ["init", "--bare"]);
  await expect(resolveScopes(path, "project", true)).rejects.toMatchObject({
    code: "PROJECT_REQUIRED",
  });
});

test("identity creation is atomic, shared by worktrees, and survives relocation", async () => {
  const base = await temporary();
  const repo = join(base, "repo");
  await mkdir(repo);
  await git(repo, ["init"]);
  await git(repo, [
    "-c",
    "user.name=Mem Test",
    "-c",
    "user.email=mem@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  expect(await resolveScopes(repo, "project", false)).toEqual([]);
  await expect(readFile(join(repo, ".git", "mem-project-id"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const identities = await Promise.all(
    Array.from({ length: 12 }, () => resolveScopes(repo, "project", true)),
  );
  expect(new Set(identities.map((scopes) => scopes[0]?.id)).size).toBe(1);
  const linked = join(base, "linked");
  await git(repo, ["worktree", "add", "-b", "linked", linked]);
  expect(await resolveScopes(linked, "project", false)).toEqual(identities[0]);
  const moved = join(base, "moved");
  await rename(repo, moved);
  expect((await resolveScopes(moved, "project", false))[0]?.id).toBe(identities[0]?.[0]?.id);
});

test("existing Git configuration identity is honored and malformed configuration fails", async () => {
  const repo = await temporary();
  await git(repo, ["init"]);
  await git(repo, ["config", "--local", "mem.project-id", "existing"]);
  expect((await resolveScopes(repo, "project", false))[0]?.id).toBe("project-existing");
  await writeFile(join(repo, ".git", "config"), "[invalid");
  await expect(resolveScopes(repo, "both", false)).rejects.toMatchObject({ code: "GIT_ERROR" });
});

test("settings defaults and environment overrides", async () => {
  const path = join(await temporary(), "config.json");
  expect(await loadSettings(path, {})).toEqual({
    model: "deepseek-v4.1-flash",
    baseUrl: "http://127.0.0.1:8317/v1",
    nodeBytes: 512,
    contextBytes: 8192,
    inputBytes: 131072,
    timeoutMs: 60000,
  });
  await writeFile(
    path,
    JSON.stringify({ model: "file-model", command: ["file-command"], nodeBytes: 1024 }),
  );
  expect(
    await loadSettings(path, {
      MEM_MODEL: "env-model",
      MEM_BASE_URL: "https://example.invalid/v1",
      MEM_SUMMARIZER_COMMAND: '["command","--argument"]',
      MEM_NODE_BYTES: "2048",
    }),
  ).toMatchObject({
    model: "env-model",
    baseUrl: "https://example.invalid/v1",
    command: ["command", "--argument"],
    nodeBytes: 2048,
  });
});

test("settings reject invalid JSON, unknown keys, values, and bounds", async () => {
  const path = join(await temporary(), "config.json");
  for (const value of [
    "{",
    "null",
    '{"secret":"x"}',
    '{"command":[]}',
    '{"command":[1]}',
    '{"model":""}',
    '{"baseUrl":"file:///tmp/x"}',
    '{"nodeBytes":0}',
    '{"timeoutMs":3600001}',
    '{"contextBytes":1.5}',
  ]) {
    await writeFile(path, value);
    await expect(loadSettings(path, {})).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  }
  await writeFile(path, "{}");
  for (const env of [
    { MEM_SUMMARIZER_COMMAND: "echo hi" },
    { MEM_NODE_BYTES: "NaN" },
    { MEM_BASE_URL: "invalid" },
  ]) {
    await expect(loadSettings(path, env)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  }
});
