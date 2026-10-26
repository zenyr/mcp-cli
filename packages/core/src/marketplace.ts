export type PluginPermissions = {
  localCode: boolean;
  network: readonly string[];
  filesystem: readonly string[];
};
export type MarketplaceAction =
  | { type: "source.add"; url: string }
  | { type: "source.refresh" | "source.remove"; id: string }
  | {
      type: "plugin.install";
      sourceId: string;
      pluginId: string;
      enable?: boolean;
      allowLocalCode?: boolean;
    }
  | { type: "plugin.enable"; key: string; enabled: boolean; allowLocalCode?: boolean }
  | { type: "plugin.remove"; key: string }
  | { type: "plugin.link"; directory: string }
  | { type: "commands.install"; directory?: string };
export type MarketplacePlugin = {
  key: string;
  sourceId: string;
  sourceName: string;
  id: string;
  name: string;
  service: string;
  description: string;
  version: string;
  permissions: PluginPermissions;
  installedPermissions?: PluginPermissions;
  installed: boolean;
  enabled: boolean;
  installedVersion?: string;
  development: boolean;
  supported: boolean;
  updateAvailable: boolean;
  revoked?: string;
};
export type MarketplaceView = {
  recommendations: { id: string; url: string; name: string; description: string }[];
  sources: { id: string; url: string; commit: string; name: string }[];
  plugins: MarketplacePlugin[];
  commandDirectory: string;
  onPath: boolean;
};
