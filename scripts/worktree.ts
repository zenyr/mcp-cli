import { lstat, readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

export type Context = {
  root: string;
  force: boolean;
  dryRun: boolean;
  log: (line: string) => void;
};

/** One setup concern; `clean` undoes whatever `init` left behind. */
type Step = {
  name: string;
  init?: (context: Context) => Promise<void>;
  clean?: (context: Context) => Promise<void>;
};

const git = async (root: string, ...args: string[]) => {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { code, out: out.trim() };
};

/** A linked worktree has its own git dir inside the common `.git/worktrees`. */
export const isLinkedWorktree = async (root: string): Promise<boolean> => {
  const dirs = await git(
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
  );
  const [gitDir, commonDir] = dirs.out.split("\n");
  return dirs.code === 0 && gitDir !== commonDir;
};

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

const workspaceDirs = async (root: string): Promise<string[]> => {
  const pkg: unknown = await Bun.file(join(root, "package.json")).json();
  const patterns =
    typeof pkg === "object" && pkg !== null && "workspaces" in pkg && Array.isArray(pkg.workspaces)
      ? pkg.workspaces.filter((entry): entry is string => typeof entry === "string")
      : [];
  const dirs: string[] = [];
  for (const pattern of patterns)
    for await (const file of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root }))
      dirs.push(join(root, file, ".."));
  return dirs.sort();
};

const ARTIFACTS = ["node_modules", ".turbo", "dist"];

/** Ignored install and build artifacts only, so tracked or user files are never deleted. */
export const cleanTargets = async (root: string): Promise<string[]> => {
  const candidates: string[] = [];
  for (const dir of [root, ...(await workspaceDirs(root))])
    for (const name of ARTIFACTS) {
      const path = join(dir, name);
      if (await exists(path)) candidates.push(path);
    }
  const targets: string[] = [];
  for (const path of candidates)
    if ((await git(root, "check-ignore", "-q", relative(root, path))).code === 0)
      targets.push(path);
  return targets;
};

const globalLink = () => join(homedir(), ".bun", "install", "global", "node_modules", "mcp-cli");

/** True when `bun link` was run here, so global commands would break once this tree is gone. */
export const linksHere = async (root: string, link = globalLink()): Promise<boolean> => {
  const target = await readlink(link).catch(() => undefined);
  return target !== undefined && resolve(link, "..", target) === resolve(root);
};

const steps: Step[] = [
  {
    name: "toolchain",
    init: async ({ root, log }) => {
      const pkg: unknown = await Bun.file(join(root, "package.json")).json();
      const wanted =
        typeof pkg === "object" && pkg !== null && "packageManager" in pkg
          ? String(pkg.packageManager).replace(/^bun@/, "")
          : undefined;
      if (wanted && wanted !== Bun.version)
        log(`warning: bun ${Bun.version} differs from packageManager bun@${wanted}`);
      if (!(await exists(join(root, "node_modules"))))
        throw new Error("node_modules is missing; run `bun i` before `worktree.ts init`");
    },
  },
  {
    name: "hooks",
    init: async ({ root, log, dryRun }) => {
      const hooks = await git(root, "rev-parse", "--path-format=absolute", "--git-path", "hooks");
      if (await exists(join(hooks.out, "pre-commit"))) return;
      log("installing lefthook hooks");
      if (dryRun) return;
      const child = Bun.spawn(["bunx", "lefthook", "install"], { cwd: root, stdout: "ignore" });
      if ((await child.exited) !== 0) throw new Error("lefthook install failed");
    },
  },
  {
    name: "global-link",
    init: async ({ root, log }) => {
      if (await linksHere(root))
        log(
          "warning: global mcp-cli commands point at this worktree; relink from the main checkout",
        );
    },
    clean: async ({ root, log, dryRun }) => {
      if (!(await linksHere(root))) return;
      log("unlinking global mcp-cli commands that point at this worktree");
      if (dryRun) return;
      await Bun.spawn(["bun", "unlink"], { cwd: root, stdout: "ignore", stderr: "ignore" }).exited;
    },
  },
  {
    name: "artifacts",
    clean: async ({ root, log, dryRun }) => {
      for (const path of await cleanTargets(root)) {
        log(`remove ${relative(root, path)}`);
        if (!dryRun) await rm(path, { recursive: true, force: true });
      }
    },
  },
];

export const run = async (command: string, context: Context): Promise<void> => {
  if (command === "clean" && !context.force && !(await isLinkedWorktree(context.root)))
    throw new Error("Refusing to clean the main checkout; pass --force to override");
  for (const step of steps) {
    const action = command === "init" ? step.init : step.clean;
    if (!action) continue;
    context.log(`[${step.name}]`);
    await action(context);
  }
  context.log(`${command} done${context.dryRun ? " (dry run)" : ""}`);
};

if (import.meta.main) {
  const [command, ...flags] = process.argv.slice(2);
  const unknown = flags.filter((flag) => flag !== "--force" && flag !== "--dry-run");
  if ((command !== "init" && command !== "clean") || unknown.length) {
    console.error("Usage: bun scripts/worktree.ts <init|clean> [--dry-run] [--force]");
    process.exit(2);
  }
  try {
    await run(command, {
      root: resolve(import.meta.dir, ".."),
      force: flags.includes("--force"),
      dryRun: flags.includes("--dry-run"),
      log: (line) => console.log(line),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
