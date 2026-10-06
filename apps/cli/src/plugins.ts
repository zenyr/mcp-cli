import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UsageError,
  decodeManifest,
  isRecord,
  type Manifest,
  type ServicePlugin,
} from "@mcp-cli/core";

type Entry = { specifier: string; load: () => Promise<{ default: ServicePlugin }> };
export const registry: Readonly<Record<string, Entry>> = {
  demo: { specifier: "@mcp-cli/plugin-demo", load: () => import("@mcp-cli/plugin-demo") },
  notion: { specifier: "@mcp-cli/plugin-notion", load: () => import("@mcp-cli/plugin-notion") },
};
export const serviceNames = Object.keys(registry);

const entry = (name: string): Entry => {
  const found = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (!found) throw new UsageError(`Unknown service: ${name}`);
  return found;
};

export const loadPlugin = async (name: string): Promise<ServicePlugin> => {
  const plugin = (await entry(name).load()).default;
  if (plugin.name !== name)
    throw new Error(`Registry key ${name} does not match plugin name ${plugin.name}`);
  return plugin;
};

// Locates generated files through the plugin package so paths with spaces resolve correctly.
export const generatedFiles = (name: string): { module: string; snapshot: string } => {
  const root = dirname(fileURLToPath(import.meta.resolve(`${entry(name).specifier}/package.json`)));
  return { module: join(root, "src", "generated.ts"), snapshot: join(root, "src", "tools.json") };
};

export const loadManifest = async (name: string): Promise<Manifest> => {
  if (!(await Bun.file(generatedFiles(name).module).exists()))
    throw new Error(`${name} is not generated yet. Run mcp-cli generate ${name} first`);
  const module: unknown = await import(`${entry(name).specifier}/generated`);
  if (!isRecord(module)) throw new Error(`Invalid generated module: ${name}`);
  return decodeManifest(module.manifest);
};
