import type { GeneratedManifest, ServicePlugin } from "@mcp-cli/core";

export type BundledPlugin = {
  packageName: string;
  plugin: ServicePlugin;
  manifest: GeneratedManifest;
};

let plugins: readonly BundledPlugin[] = [];
export const installBundledPlugins = (value: readonly BundledPlugin[]): void => {
  plugins = value;
};
export const bundledPlugins = (): readonly BundledPlugin[] => plugins;
