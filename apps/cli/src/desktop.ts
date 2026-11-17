import { decodeWorkspaceAction, selectWorkspace, updateWorkspace } from "./workspaces";
import { createInterface } from "node:readline";
import { isRecord, UsageError } from "@mcp-cli/core";
import { defaultStore, loginCommand, logoutCommand } from "./auth";
import { discover, findPlugin, loadPlugin } from "./discovery";
import { defaultContext } from "./paths";
import { resetDaemonIfRunning } from "./daemon/client";
import { authenticationDetails, configureAuthentication } from "./auth-settings";
import { marketplaceRequest, marketplaceView } from "./marketplace/entry";
import { Effect } from "effect";
import { CliHost, processHost } from "./host";
import { desktopService } from "./desktop-services";
import { desktopCommandCatalog } from "./desktop-commands";

// Bridges marketplace Effects until the desktop command moves onto CliHost.
const runOnProcessHost = <A>(effect: Effect.Effect<A, unknown, CliHost>): Promise<A> =>
  Effect.runPromise(Effect.provideService(effect, CliHost, processHost));

const readAuthInput = async (): Promise<string> => {
  const lines = createInterface({ input: process.stdin });
  const input: string[] = [];
  try {
    for await (const line of lines) {
      input.push(line);
      try {
        JSON.parse(input.join("\n"));
        return input.join("\n");
      } catch {
        continue;
      }
    }
    return input.join("\n");
  } finally {
    lines.close();
    process.stdin.destroy();
  }
};

// Bun truncates piped console.log output at 64 KiB once process.stdout exists.
const writeResult = (result: unknown) =>
  new Promise<void>((resolve, reject) =>
    process.stdout.write(`${JSON.stringify({ result })}\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );

export const desktopCommand = async (args: string[]) => {
  const [action, ...rest] = args;
  if (
    rest.length ||
    ![
      "services",
      "login",
      "logout",
      "auth-config",
      "auth-status",
      "plugins",
      "plugin-action",
      "workspace-action",
      "commands",
    ].includes(action ?? "")
  )
    throw new UsageError(
      "Usage: mcp-cli desktop <services|commands|plugins|plugin-action|workspace-action|login|logout|auth-config|auth-status>",
    );
  if (action === "plugins") {
    await writeResult(await runOnProcessHost(marketplaceView()));
    return;
  }
  if (action === "commands") {
    await writeResult(await desktopCommandCatalog(JSON.parse(await readAuthInput())));
    return;
  }
  if (action === "plugin-action") {
    await writeResult(
      await runOnProcessHost(marketplaceRequest(JSON.parse(await readAuthInput()))),
    );
    return;
  }
  const registry = await discover(await defaultContext(process.env));
  if (action === "workspace-action") {
    const request = decodeWorkspaceAction(JSON.parse(await readAuthInput()));
    const plugin = await loadPlugin(findPlugin(registry, request.service), registry.context);
    await writeResult(await updateWorkspace(plugin, request));
    return;
  }
  const store = defaultStore(process.env);
  if (action === "services") {
    const services = await Promise.all(
      registry.plugins.map((found) => desktopService(found, registry, store)),
    );
    await writeResult(services);
    return;
  }
  const value: unknown = JSON.parse(await readAuthInput());
  if (
    !isRecord(value) ||
    typeof value.service !== "string" ||
    (value.credential !== undefined && typeof value.credential !== "string") ||
    (value.workspace !== undefined && typeof value.workspace !== "string")
  )
    throw new UsageError("Invalid desktop auth request");
  const service = value.service;
  const plugin = await selectWorkspace(
    await loadPlugin(findPlugin(registry, service), registry.context),
    typeof value.workspace === "string" ? value.workspace : undefined,
  );
  if (action === "auth-config" || action === "auth-status") {
    if (action === "auth-config") await configureAuthentication(plugin, value.configuration);
    await writeResult(await authenticationDetails(plugin, action === "auth-status"));
    return;
  }
  const credential =
    typeof value.credential === "string" && value.credential ? value.credential : undefined;
  const flags = credential ? [`--${credential}`] : [];
  if (plugin.workspace) flags.push("--workspace", plugin.workspace.id);
  if (value.method === "browser") flags.push("--browser");
  if (value.target !== undefined) {
    const details = await authenticationDetails(plugin);
    if (
      typeof value.target !== "string" ||
      !details?.states.some((state) => state.target === value.target)
    )
      throw new UsageError("Invalid authentication target");
  }
  const run = action === "login" ? loginCommand : logoutCommand;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGTERM", abort);
  try {
    await run([service, ...flags], {
      env: process.env,
      store,
      signal: controller.signal,
      target: typeof value.target === "string" ? value.target : undefined,
      plugin: async (name) => loadPlugin(findPlugin(registry, name)),
      writeError: () => undefined,
      open: (url) => {
        console.log(JSON.stringify({ event: "open-url", url }));
      },
      readSecret: async () => {
        if (typeof value.secret !== "string") throw new UsageError("API key is required");
        return value.secret;
      },
    });
  } finally {
    process.removeListener("SIGTERM", abort);
  }
  await resetDaemonIfRunning(process.env);
  await writeResult(null);
};
