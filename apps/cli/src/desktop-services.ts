import { credentialSwitches, type TokenStore } from "@mcp-cli/core";
import { authCredentialName } from "./auth";
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
            (await pluginStore(plugin, store).read(
              authCredentialName(plugin, flag || undefined),
            )) !== undefined,
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
