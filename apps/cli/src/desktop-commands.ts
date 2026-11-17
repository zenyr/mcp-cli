import {
  applyCustomizations,
  isRecord,
  UsageError,
  type CommandCatalog,
  type GeneratedManifest,
  type ServicePlugin,
} from "@mcp-cli/core";
import { commandTree, sessionManifest } from "@mcp-cli/runtime";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { loadManifest } from "./plugins";
import { runtimeDependencies } from "./runtime";

const liveManifest = async (
  plugin: ServicePlugin,
  workspace: string | undefined,
): Promise<{ manifest: GeneratedManifest; workspace?: string }> => {
  const selected = await runtimeDependencies(plugin).forWorkspace?.(workspace);
  if (!selected) throw new UsageError("This runtime does not support workspace selection");
  const session = await selected.open();
  try {
    return {
      manifest: await sessionManifest(plugin.name, session),
      workspace: selected.workspace?.name,
    };
  } finally {
    await session.close();
  }
};

export const desktopCommandCatalog = async (input: unknown): Promise<CommandCatalog> => {
  if (
    !isRecord(input) ||
    typeof input.service !== "string" ||
    (input.live !== undefined && typeof input.live !== "boolean") ||
    (input.workspace !== undefined && typeof input.workspace !== "string")
  )
    throw new UsageError("Invalid desktop commands request");
  const registry = await discover(await defaultContext(process.env));
  const found = findPlugin(registry, input.service);
  const plugin = await loadPlugin(found, registry.context);
  const discovery = plugin.discovery?.tools === "session";
  if (discovery && input.live === true) {
    const live = await liveManifest(
      plugin,
      typeof input.workspace === "string" ? input.workspace : undefined,
    );
    return {
      service: plugin.name,
      origin: "live",
      discovery,
      fetchedAt: Date.now(),
      ...(live.workspace && { workspace: live.workspace }),
      root: commandTree(applyCustomizations(plugin, live.manifest)),
    };
  }
  const manifest = applyCustomizations(plugin, await loadManifest(registry, found));
  return {
    service: plugin.name,
    origin: discovery ? "bootstrap" : "static",
    discovery,
    root: commandTree(manifest),
  };
};
