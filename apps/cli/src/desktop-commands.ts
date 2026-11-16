import { applyCustomizations, isRecord, UsageError, type CommandCatalog } from "@mcp-cli/core";
import { commandTree } from "@mcp-cli/runtime";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { loadManifest } from "./plugins";

export const desktopCommandCatalog = async (input: unknown): Promise<CommandCatalog> => {
  if (!isRecord(input) || typeof input.service !== "string")
    throw new UsageError("Invalid desktop commands request");
  const registry = await discover(await defaultContext());
  const found = findPlugin(registry, input.service);
  const plugin = await loadPlugin(found, registry.context);
  const manifest = applyCustomizations(plugin, await loadManifest(registry, found));
  return {
    service: plugin.name,
    bootstrap: plugin.discovery?.tools === "session",
    root: commandTree(manifest),
  };
};
