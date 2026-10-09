import type { ExtensionCommand, Manifest } from "@mcp-cli/core";

export const findExtension = (manifest: Manifest, path: string[]): ExtensionCommand | undefined =>
  manifest.extensions?.find((command) => command.path.join(" ") === path.join(" "));
