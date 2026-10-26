import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord, type ServicePlugin } from "@mcp-cli/core";
import { workspacePackages } from "../src/packages";
import { packDirectory } from "../src/marketplace/archive";
import { digest } from "../src/marketplace/storage";
import {
  Catalog,
  decode,
  type CatalogPlugin,
  type PackageManifest,
} from "../src/marketplace/schema";

export const packageWorkspacePlugins = async (root: string, output: string): Promise<void> => {
  await mkdir(output, { recursive: true });
  const catalog: CatalogPlugin[] = [];
  for (const info of await workspacePackages(root)) {
    const plugin: ServicePlugin = (await import(pathToFileURL(info.entry).href)).default;
    const generated = (await import(pathToFileURL(join(info.dir, "src/generated.ts")).href))
      .manifest;
    const pkg: unknown = JSON.parse(await readFile(join(info.dir, "package.json"), "utf8"));
    if (!isRecord(pkg) || typeof pkg.version !== "string")
      throw new Error(`Missing version: ${info.dir}`);
    const directory = await mkdtemp(join(tmpdir(), "mcp-plugin-package-"));
    try {
      const metadata = {
        id: `builtin.${plugin.name}`,
        service: plugin.name,
        name: plugin.name,
        description: plugin.summary,
        version: String(pkg.version),
        permissions: { localCode: true, network: [], filesystem: ["User account access"] },
      };
      const manifest: PackageManifest =
        plugin.name === "demo"
          ? {
              schemaVersion: 1,
              ...metadata,
              commands: plugin.commands,
              implementation: {
                type: "mcp",
                server: { type: "stdio", runtime: "bun", entry: "server.mjs" },
              },
            }
          : {
              schemaVersion: 1,
              ...metadata,
              implementation: { type: "module", entry: "plugin.mjs" },
            };
      const source = plugin.name === "demo" ? join(info.dir, "src/server.ts") : info.entry;
      const result = await Bun.build({
        entrypoints: [source],
        outdir: directory,
        naming: plugin.name === "demo" ? "server.mjs" : "plugin.mjs",
        target: "bun",
        minify: true,
      });
      if (!result.success) throw new Error(result.logs.map(String).join("\n"));
      await writeFile(join(directory, "plugin.json"), JSON.stringify(manifest));
      await writeFile(join(directory, "manifest.json"), JSON.stringify(generated));
      const archive = await packDirectory(directory);
      const filename = `${plugin.name}-${pkg.version}.tar.gz`;
      await writeFile(join(output, filename), archive);
      catalog.push({
        ...metadata,
        artifacts: [{ url: filename, sha256: digest(archive), platform: "any", arch: "any" }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  const value = decode(
    Catalog,
    { schemaVersion: 1, name: "기본 플러그인", plugins: catalog },
    "built-in catalog",
  );
  await writeFile(join(output, "marketplace.json"), `${JSON.stringify(value, null, 2)}\n`);
};
