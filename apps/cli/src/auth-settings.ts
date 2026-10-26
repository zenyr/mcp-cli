import { UsageError, type ServicePlugin } from "@mcp-cli/core";
import { defaultSettings, defaultStore } from "./auth";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { resetDaemonIfRunning } from "./daemon/client";

export const authenticationContext = (env = process.env) => ({
  env,
  store: defaultStore(env),
  settings: defaultSettings(env),
});
export const authenticationDetails = async (plugin: ServicePlugin, check = false) => {
  if (!plugin.authSupport) return undefined;
  const context = authenticationContext();
  return {
    configuration: await plugin.authSupport.configuration(context),
    states: await plugin.authSupport.status(context, check),
  };
};
export const configureAuthentication = async (plugin: ServicePlugin, value: unknown) => {
  if (!plugin.authSupport) throw new UsageError("This service has no authentication settings.");
  await plugin.authSupport.configure(authenticationContext(), value);
  await resetDaemonIfRunning();
};
export const authSettingsCommand = async (args: string[]) => {
  const [action, service, flag, ...rest] = args;
  if (
    !service ||
    rest.length ||
    !["configure", "status"].includes(action ?? "") ||
    (flag !== undefined && (action !== "status" || flag !== "--check"))
  )
    throw new UsageError(
      "Usage: mcp-cli auth configure <service> < settings.json | mcp-cli auth status <service> [--check]",
    );
  const registry = await discover(await defaultContext());
  const plugin = await loadPlugin(findPlugin(registry, service));
  if (!plugin.authSupport) throw new UsageError("This service has no authentication settings.");
  if (action === "configure") {
    let value: unknown;
    try {
      value = await Bun.stdin.json();
    } catch {
      throw new UsageError("Supply authentication settings as JSON on stdin.");
    }
    await configureAuthentication(plugin, value);
  }
  console.log(JSON.stringify(await authenticationDetails(plugin, flag === "--check")));
};
