import { selectWorkspace } from "./workspaces";
import { extractWorkspace } from "./workspace-arguments";
import { formatOutput } from "@mcp-cli/runtime";
import { UsageError, type ServicePlugin } from "@mcp-cli/core";
import { Effect } from "effect";
import { attempt } from "./attempt";
import { defaultSettings, defaultStore } from "./auth";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { resetDaemonIfRunning } from "./daemon/client";
import { CliHost, printLine, type Env } from "./host";
import { pluginEnvironment, pluginSettings, pluginStore } from "./plugin-credentials";

export const authenticationContext = (env: Env, plugin?: ServicePlugin) => ({
  env: plugin ? pluginEnvironment(plugin, env) : env,
  store: plugin ? pluginStore(plugin, defaultStore(env)) : defaultStore(env),
  settings: plugin ? pluginSettings(plugin, defaultSettings(env)) : defaultSettings(env),
});
export const authenticationDetails = async (plugin: ServicePlugin, env: Env, check = false) => {
  if (!plugin.authSupport) return undefined;
  const context = authenticationContext(env, plugin);
  return {
    fields: plugin.authSupport.fields ?? [],
    configuration: await plugin.authSupport.configuration(context),
    states: await plugin.authSupport.status(context, check),
  };
};
export const configureAuthentication = async (plugin: ServicePlugin, env: Env, value: unknown) => {
  if (!plugin.authSupport) throw new UsageError("This service has no authentication settings.");
  await plugin.authSupport.configure(authenticationContext(env, plugin), value);
  await resetDaemonIfRunning(env);
};

const USAGE =
  "Usage: mcp-cli auth configure <service> < settings.json | mcp-cli auth status <service> [--check]";

export const authSettingsCommand = (argv: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const selected = extractWorkspace(argv);
    const json = selected.args.includes("--json");
    const args = selected.args.filter((arg) => arg !== "--json");
    const [action, service, flag, ...rest] = args;
    if (
      !service ||
      rest.length ||
      !["configure", "status"].includes(action ?? "") ||
      (flag !== undefined && (action !== "status" || flag !== "--check"))
    )
      return yield* Effect.fail(new UsageError(USAGE));
    const plugin = yield* attempt(async () => {
      const registry = await discover(await defaultContext(host.env));
      return selectWorkspace(
        await loadPlugin(findPlugin(registry, service), registry.context),
        selected.workspace,
        defaultSettings(host.env),
      );
    });
    if (!plugin.authSupport)
      return yield* Effect.fail(new UsageError("This service has no authentication settings."));
    if (action === "configure") {
      const value = yield* Effect.tryPromise({
        try: async (): Promise<unknown> => JSON.parse(await host.readStdin()),
        catch: () => new UsageError("Supply authentication settings as JSON on stdin."),
      });
      yield* attempt(() => configureAuthentication(plugin, host.env, value));
    }
    const details = yield* attempt(() =>
      authenticationDetails(plugin, host.env, flag === "--check"),
    );
    yield* printLine(formatOutput(details, json));
  });
