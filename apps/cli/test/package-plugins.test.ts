import { expect, test } from "bun:test";
import { isRecord } from "@mcp-cli/core";
import { selectPackages } from "../scripts/package-plugins";
import type { PackageInfo } from "../src/packages";

const info = (service: string, hidden?: boolean, workspaceOnly?: boolean): PackageInfo => ({
  dir: `/plugins/${service}`,
  name: `@mcp-cli/plugin-${service}`,
  marked: true,
  service,
  entry: `/plugins/${service}/src/index.ts`,
  ...(hidden && { hidden }),
  ...(workspaceOnly && { workspaceOnly }),
});
const infos = [info("demo", true), info("demo-auth", true), info("notion"), info("slack")];

test("release catalogs exclude hidden plugins unless they are named", () => {
  expect(selectPackages(infos).map((item) => item.service)).toEqual(["notion", "slack"]);
  expect(selectPackages(infos, ["demo", "demo-auth"]).map((item) => item.service)).toEqual([
    "demo",
    "demo-auth",
  ]);
  expect(() => selectPackages(infos, ["demo", "missing"])).toThrow("missing");
});

test("release catalogs never bundle workspace-only plugins, even when named", () => {
  const local = [...infos, info("mem", false, true)];
  expect(selectPackages(local).map((item) => item.service)).toEqual(["notion", "slack"]);
  expect(() => selectPackages(local, ["notion", "mem"])).toThrow("Workspace-only plugins");
});

test("packages additional runtime modules with the standalone runtime flag", async () => {
  const { bundleRuntimeEntries } = await import("../scripts/package-plugins");
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "runtime-entry-"));
  try {
    await writeFile(join(root, "worker.ts"), "export const packaged = MCP_CLI_BUNDLED;");
    const output = join(root, "output");
    await bundleRuntimeEntries(root, output, { "worker.mjs": "worker.ts" });
    expect(await readFile(join(output, "worker.mjs"), "utf8")).toContain("export");
    const built: unknown = await import(join(output, "worker.mjs"));
    expect(isRecord(built) && built.packaged).toBe(true);
    await expect(
      bundleRuntimeEntries(root, output, { "../escape.mjs": "worker.ts" }),
    ).rejects.toThrow();
    await expect(
      bundleRuntimeEntries(root, output, { "plugin.mjs": "worker.ts" }),
    ).rejects.toThrow();
    await expect(
      bundleRuntimeEntries(root, output, { "worker.mjs": "../escape.ts" }),
    ).rejects.toThrow();
    await expect(bundleRuntimeEntries(root, output, { "worker.mjs": 12 })).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
