import type { ServicePlugin } from "@mcp-cli/core";
const registry: Record<string, () => Promise<{ default: ServicePlugin }>> = {
  demo: () => import("@mcp-cli/plugin-demo"),
  notion: () => import("@mcp-cli/plugin-notion"),
};
export const serviceNames = Object.keys(registry);
export const loadPlugin = async (name: string): Promise<ServicePlugin> => {
  if (!Object.hasOwn(registry, name)) throw new Error(`Unknown service: ${name}`);
  const load = registry[name];
  if (!load) throw new Error(`Unknown service: ${name}`);
  return (await load()).default;
};
export const generatedPath = (name: string): string =>
  new URL(`../../../plugins/${name}/src/generated.ts`, import.meta.url).pathname;
