import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import type { Env, Scope } from "./types";
import { fail } from "./values";

export const resolvePaths = (env: Env): { configFile: string; databaseFile: string } => {
  const home = env.HOME || homedir();
  const config =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(home, ".config");
  const data =
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share");
  return {
    configFile: join(config, "mem", "config.json"),
    databaseFile: join(data, "mem", "memory.sqlite"),
  };
};

const git = async (cwd: string, args: string[]) => {
  const process = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, text: stdout.trim() };
};

const readIdentity = async (path: string): Promise<string | undefined> => {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const projectIdentity = async (
  cwd: string,
  commonDir: string,
  create: boolean,
): Promise<string | undefined> => {
  const configured = await git(cwd, ["config", "--local", "--get", "mem.project-id"]);
  if (configured.code !== 0 && configured.code !== 1)
    return fail("GIT_ERROR", "Cannot read Git project configuration.");
  if (configured.code === 0 && configured.text) return configured.text;
  const path = join(commonDir, "mem-project-id");
  const existing = await readIdentity(path);
  if (existing !== undefined || !create) return existing;
  const id = randomUUID();
  const temporary = join(commonDir, `mem-project-id.${id}.tmp`);
  await writeFile(temporary, `${id}\n`, { flag: "wx", mode: 0o600 });
  try {
    // A hard link publishes the complete identity atomically across linked worktrees.
    try {
      await link(temporary, path);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    return await readIdentity(path);
  } finally {
    await unlink(temporary);
  }
};

export const resolveScopes = async (
  cwd: string,
  selection: "both" | "global" | "project",
  create: boolean,
): Promise<Scope[]> => {
  const global: Scope = { id: "global", name: "global", kind: "global" };
  if (selection === "global") return [global];
  const configuration = await git(cwd, ["config", "--list"]);
  if (configuration.code !== 0) return fail("GIT_ERROR", "Cannot read Git configuration.");
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root.code !== 0) {
    if (root.code !== 128) return fail("GIT_ERROR", "Cannot resolve Git worktree.");
    if (selection === "project") return fail("PROJECT_REQUIRED", "A Git worktree is required.");
    return [global];
  }
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return fail("GIT_ERROR", "Cannot resolve Git common directory.");
  const id = await projectIdentity(cwd, common.text, create);
  if (id !== undefined && !/^[a-zA-Z0-9._-]{1,128}$/.test(id))
    return fail(
      "PROJECT_ID_INVALID",
      "Project identity must contain 1..128 ASCII letters, digits, dots, underscores, or hyphens.",
    );
  const scopes: Scope[] = selection === "both" ? [global] : [];
  if (id)
    scopes.push({ id: `project-${id}`, name: basename(dirname(common.text)), kind: "project" });
  return scopes;
};
