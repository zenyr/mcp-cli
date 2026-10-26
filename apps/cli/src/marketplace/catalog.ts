import type { MarketplaceView } from "@mcp-cli/core";
import { builtins } from "./builtins";
import { pathStatus, userBin } from "./commands";
import { attempt, pluginKey, readState, type MarketContext } from "./storage";
import {
  selectArtifact,
  type CatalogPlugin,
  type Installed,
  type Source,
  type State,
} from "./schema";

export type PluginView = {
  key: string;
  sourceId: string;
  sourceName: string;
  metadata: CatalogPlugin;
  installed?: Installed;
  supported: boolean;
  updateAvailable: boolean;
  revoked?: string;
};
export const revoked = (sources: readonly Source[], plugin: Installed): string | undefined =>
  sources
    .find((source) => source.id === plugin.sourceId)
    ?.catalog.revoked?.find(
      (entry) => entry.id === plugin.metadata.id && entry.sha256 === plugin.artifact.sha256,
    )?.reason;
export const allSources = async (state: State): Promise<Source[]> => {
  const builtin = await builtins();
  return [...(builtin ? [builtin] : []), ...state.sources];
};

export const marketView = (context: MarketContext) =>
  attempt("list plugins", async (): Promise<MarketplaceView> => {
    const state = await readState(context);
    const sources = await allSources(state);
    const plugins = new Map<string, PluginView>();
    for (const source of sources)
      for (const metadata of source.catalog.plugins) {
        const key = pluginKey(source.id, metadata.id);
        const installed = state.installed.find((item) => item.key === key);
        let supported = true;
        let updateAvailable = false;
        try {
          updateAvailable = Boolean(
            installed && selectArtifact(metadata.artifacts).sha256 !== installed.artifact.sha256,
          );
        } catch {
          supported = false;
        }
        plugins.set(key, {
          key,
          sourceId: source.id,
          sourceName: source.catalog.name,
          metadata,
          installed,
          supported,
          updateAvailable,
          revoked: installed ? revoked(sources, installed) : undefined,
        });
      }
    for (const installed of state.installed)
      if (!plugins.has(installed.key))
        plugins.set(installed.key, {
          key: installed.key,
          sourceId: installed.sourceId,
          sourceName: installed.developmentPath ? "개발 폴더" : "설치된 플러그인",
          metadata: installed.metadata,
          installed,
          supported: true,
          updateAvailable: false,
          revoked: revoked(sources, installed),
        });
    const commandDirectory = state.commands?.directory ?? userBin(context);
    return {
      sources: sources.map((source) => ({
        id: source.id,
        url: source.url,
        commit: source.commit,
        name: source.catalog.name,
      })),
      plugins: [...plugins.values()].map((item) => ({
        key: item.key,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        id: item.metadata.id,
        name: item.metadata.name,
        service: item.metadata.service,
        description: item.metadata.description,
        version: item.metadata.version,
        permissions: item.metadata.permissions,
        installedPermissions: item.installed?.metadata.permissions,
        installed: Boolean(item.installed),
        enabled: item.installed?.enabled ?? false,
        installedVersion: item.installed?.metadata.version,
        development: Boolean(item.installed?.developmentPath),
        supported: item.supported,
        updateAvailable: item.updateAvailable,
        revoked: item.revoked,
      })),
      commandDirectory,
      onPath: pathStatus(context, commandDirectory),
    };
  });
