import { expect, test } from "bun:test";
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
