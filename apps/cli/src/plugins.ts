import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NotGeneratedError, decodeManifest, isRecord, type GeneratedManifest } from "@mcp-cli/core";
import type { DiscoveredPlugin, Registry } from "./discovery";
import { cacheDir } from "./paths";
import { readInstalledManifest } from "./marketplace/packages";

export type GeneratedLocation = "package" | "cache";
export type GeneratedFiles = { location: GeneratedLocation; module: string; snapshot: string };

const filesIn = (location: GeneratedLocation, dir: string): GeneratedFiles => ({
  location,
  module: join(dir, "generated.ts"),
  snapshot: join(dir, "tools.json"),
});

export const packageFiles = (plugin: DiscoveredPlugin): GeneratedFiles =>
  filesIn("package", join(plugin.dir, "src"));

export const cacheFiles = (registry: Registry, plugin: DiscoveredPlugin): GeneratedFiles =>
  filesIn(
    "cache",
    cacheDir(
      registry.context,
      plugin.installed ? `${plugin.service}-${plugin.installed.artifact.sha256}` : plugin.service,
    ),
  );

// Writable plugin packages keep generated files beside their source; installed ones use the cache.
export const outputFiles = async (
  registry: Registry,
  plugin: DiscoveredPlugin,
): Promise<GeneratedFiles> =>
  !plugin.bundled && !plugin.installed && (await registry.context.writable(plugin.dir))
    ? packageFiles(plugin)
    : cacheFiles(registry, plugin);

// The package location wins over the cache when both hold generated code.
export const existingFiles = async (
  registry: Registry,
  plugin: DiscoveredPlugin,
): Promise<GeneratedFiles | undefined> => {
  if (plugin.installed) {
    const cached = cacheFiles(registry, plugin);
    if (await Bun.file(cached.module).exists()) return cached;
    return {
      location: "package",
      module: `${plugin.dir}/manifest.json`,
      snapshot: `${plugin.dir}/manifest.json`,
    };
  }
  for (const files of plugin.bundled
    ? [cacheFiles(registry, plugin)]
    : [packageFiles(plugin), cacheFiles(registry, plugin)])
    if (await Bun.file(files.module).exists()) return files;
  return undefined;
};

export const loadManifest = async (
  registry: Registry,
  plugin: DiscoveredPlugin,
): Promise<GeneratedManifest> => {
  const name = plugin.service;
  const files = await existingFiles(registry, plugin);
  if (plugin.installed && files?.location === "package") return readInstalledManifest(plugin.dir);
  if (!files && plugin.bundled) return decodeManifest(plugin.bundled.manifest);
  if (!files)
    throw new NotGeneratedError(`${name} is not generated yet. Run mcp-cli generate ${name} first`);
  const module: unknown = await import(pathToFileURL(files.module).href);
  if (!isRecord(module)) throw new Error(`Invalid generated module: ${name}`);
  return decodeManifest(module.manifest);
};
