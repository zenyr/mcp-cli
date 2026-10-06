import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "@mcp-cli/core";

/** A package directory and the `mcp-cli` marker fields it declares. */
export type PackageInfo = {
  dir: string;
  name: string;
  marked: boolean;
  service?: string;
  entry: string;
};

const MARKER = "mcp-cli";

const firstString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === "string");

const conditional = (target: unknown): string | undefined =>
  isRecord(target) ? firstString(target.bun, target.import, target.default) : firstString(target);

// Resolves the package root export the same way Bun would for a bare import.
const entryOf = (pkg: Record<string, unknown>): string => {
  const { exports } = pkg;
  const root = isRecord(exports) && "." in exports ? exports["."] : exports;
  return conditional(root) ?? firstString(pkg.module, pkg.main) ?? "index.js";
};

export const markerError = (dir: string, reason: string): Error =>
  new Error(`Invalid ${MARKER} field in ${join(dir, "package.json")}: ${reason}`);

export const readPackage = async (dir: string): Promise<PackageInfo | undefined> => {
  const file = Bun.file(join(dir, "package.json"));
  if (!(await file.exists())) return undefined;
  const pkg: unknown = await file.json().catch(() => undefined);
  if (!isRecord(pkg)) return undefined;
  const marker = pkg[MARKER];
  const real = await realpath(dir).catch(() => undefined);
  if (real === undefined) return undefined;
  const name = typeof pkg.name === "string" ? pkg.name : real;
  const base = { dir: real, name, entry: join(real, entryOf(pkg)) };
  if (marker === undefined) return { ...base, marked: false };
  if (!isRecord(marker) || marker.plugin !== true)
    throw markerError(dir, 'expected { "plugin": true }');
  if (marker.service !== undefined && typeof marker.service !== "string")
    throw markerError(dir, "service must be a string");
  return {
    ...base,
    marked: true,
    ...(marker.service !== undefined && { service: marker.service }),
  };
};

const marked = (infos: Array<PackageInfo | undefined>): PackageInfo[] =>
  infos.filter((info): info is PackageInfo => info?.marked === true);

const workspacePatterns = (pkg: unknown): string[] => {
  if (!isRecord(pkg)) return [];
  const { workspaces } = pkg;
  const list = isRecord(workspaces) ? workspaces.packages : workspaces;
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
};

// Recursive globs and negations are skipped so a workspace scan never walks the whole tree.
export const workspacePackages = async (root: string): Promise<PackageInfo[]> => {
  const pkg: unknown = await Bun.file(join(root, "package.json"))
    .json()
    .catch(() => undefined);
  const dirs = new Set<string>();
  for (const pattern of workspacePatterns(pkg)) {
    if (pattern.includes("**") || pattern.startsWith("!")) continue;
    const glob = new Bun.Glob(`${pattern.replace(/\/$/, "")}/package.json`);
    for await (const file of glob.scan({ cwd: root, onlyFiles: true }))
      dirs.add(join(root, file, ".."));
  }
  return marked(await Promise.all([...dirs].sort().map(readPackage)));
};

const listDir = async (dir: string): Promise<string[]> =>
  readdir(dir).then(
    (names) => names.filter((name) => !name.startsWith(".")).sort(),
    () => [],
  );

// Reads direct entries and one level of scoped directories only.
export const nodeModulePackages = async (root: string): Promise<PackageInfo[]> => {
  const dirs: string[] = [];
  for (const name of await listDir(root)) {
    if (!name.startsWith("@")) dirs.push(join(root, name));
    else for (const child of await listDir(join(root, name))) dirs.push(join(root, name, child));
  }
  return marked(await Promise.all(dirs.map(readPackage)));
};
