import { credentialSwitches, type ServicePlugin, type TokenStore } from "@mcp-cli/core";
import { readWorkspaces, selectWorkspace } from "./workspaces";
import { authCredentialName, defaultSettings } from "./auth";
import { authenticationDetails } from "./auth-settings";
import { loadPlugin, type DiscoveredPlugin, type Registry } from "./discovery";
import { pluginEnvironment, pluginStore } from "./plugin-credentials";

export const desktopService = async (
  found: DiscoveredPlugin,
  registry: Registry,
  store: TokenStore,
) => {
  try {
    const plugin = await loadPlugin(found, registry.context);
    const settings = defaultSettings(process.env);
    const workspaces = await readWorkspaces(plugin, settings);
    const selected = await selectWorkspace(plugin, undefined, settings);
    return {
      ...(await serviceDetails(selected, registry, store)),
      supportsWorkspaces: Boolean(plugin.workspaces),
      defaultWorkspaceId: workspaces.defaultId,
      workspaces: plugin.workspaces
        ? await Promise.all(
            workspaces.workspaces.map(async (workspace) => ({
              ...(await serviceDetails({ ...plugin, workspace }, registry, store)),
              workspace,
            })),
          )
        : undefined,
    };
  } catch (error) {
    return {
      name: found.service,
      summary: found.installed?.metadata.description ?? found.service,
      auth: "none",
      credentials: [],
      error: error instanceof Error ? error.message : "Plugin could not be loaded.",
    };
  }
};

const serviceDetails = async (plugin: ServicePlugin, registry: Registry, store: TokenStore) => {
  const switches = credentialSwitches(plugin.auth);
  const credentials = switches.some((credential) => credential.base)
    ? switches
    : [{ flag: "", summary: "기본 인증" }, ...switches];
  return {
    name: plugin.name,
    summary: plugin.summary,
    auth: plugin.auth?.type ?? "none",
    authentication: await authenticationDetails(plugin),
    credentials: await Promise.all(
      credentials.map(async ({ flag, summary }) => ({
        flag,
        summary,
        stored:
          (await pluginStore(plugin, store).read(authCredentialName(plugin, flag || undefined))) !==
          undefined,
        fromEnv:
          plugin.auth?.type === "apiKey" &&
          Boolean(
            pluginEnvironment(plugin, registry.context.env)[
              flag
                ? (plugin.auth.alternates?.find((item) => item.flag === flag)?.env ?? "")
                : plugin.auth.env
            ],
          ),
      })),
    ),
  };
};
