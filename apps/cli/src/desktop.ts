import { decodeWorkspaceAction, selectWorkspace, workspaceUpdate } from "./workspaces";
import { isRecord, UsageError } from "@mcp-cli/core";
import { Effect } from "effect";
import { attempt, attemptSync } from "./attempt";
import { defaultSettings, defaultStore, loginCommand, logoutCommand } from "./auth";
import { discover, findPlugin, loadPlugin, type Registry } from "./discovery";
import { defaultContext } from "./paths";
import { authenticationDetails, configureAuthentication } from "./auth-settings";
import { resetDaemonIfRunning } from "./daemon/client";
import { marketplaceRequest, marketplaceView } from "./marketplace/entry";
import { desktopService } from "./desktop-services";
import { desktopCommandCatalog } from "./desktop-commands";
import { CliHost, printLine, type Host } from "./host";

const ACTIONS = [
  "services",
  "login",
  "logout",
  "auth-config",
  "auth-status",
  "plugins",
  "plugin-action",
  "workspace-action",
  "commands",
];
const USAGE =
  "Usage: mcp-cli desktop <services|commands|plugins|plugin-action|workspace-action|login|logout|auth-config|auth-status>";

// The desktop app may keep stdin open, so one request ends at the first line set that parses as JSON.
const readRequest = (host: Host): Effect.Effect<unknown, unknown> =>
  Effect.callback<unknown, unknown>((resume) => {
    const input: string[] = [];
    let done = false;
    let release = (): void => undefined;
    const finish = () => {
      done = true;
      release();
    };
    release = host.onStdinLine(
      (line) => {
        if (done) return;
        input.push(line);
        try {
          const value: unknown = JSON.parse(input.join("\n"));
          finish();
          resume(Effect.succeed(value));
        } catch {
          return;
        }
      },
      () => {
        if (done) return;
        done = true;
        // Closed stdin without a complete request fails with the parser's own message.
        resume(
          Effect.try({ try: (): unknown => JSON.parse(input.join("\n")), catch: (error) => error }),
        );
      },
    );
    if (done) release();
    return Effect.sync(finish);
  });

const writeResult = (result: unknown) => printLine(JSON.stringify({ result }));

type AuthRequest = {
  service: string;
  credential?: string;
  workspace?: string;
  method?: unknown;
  target?: unknown;
  secret?: unknown;
  configuration?: unknown;
};

const decodeAuthRequest = (value: unknown): Effect.Effect<AuthRequest, UsageError> =>
  isRecord(value) &&
  typeof value.service === "string" &&
  (value.credential === undefined || typeof value.credential === "string") &&
  (value.workspace === undefined || typeof value.workspace === "string")
    ? Effect.succeed({
        ...value,
        service: value.service,
        credential: typeof value.credential === "string" ? value.credential : undefined,
        workspace: typeof value.workspace === "string" ? value.workspace : undefined,
      })
    : Effect.fail(new UsageError("Invalid desktop auth request"));

const authAction = (action: string, registry: Registry, request: AuthRequest) =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const { env } = registry.context;
    const plugin = yield* attempt(async () =>
      selectWorkspace(
        await loadPlugin(findPlugin(registry, request.service), registry.context),
        request.workspace,
        defaultSettings(env),
      ),
    );
    if (action === "auth-config" || action === "auth-status") {
      if (action === "auth-config")
        yield* attempt(() => configureAuthentication(plugin, env, request.configuration));
      return yield* attempt(() => authenticationDetails(plugin, env, action === "auth-status"));
    }
    const flags = request.credential ? [`--${request.credential}`] : [];
    if (plugin.workspace) flags.push("--workspace", plugin.workspace.id);
    if (request.method === "browser") flags.push("--browser");
    if (request.target !== undefined) {
      const details = yield* attempt(() => authenticationDetails(plugin, env));
      if (
        typeof request.target !== "string" ||
        !details?.states.some((state) => state.target === request.target)
      )
        return yield* Effect.fail(new UsageError("Invalid authentication target"));
    }
    const run = action === "login" ? loginCommand : logoutCommand;
    const controller = new AbortController();
    const removeTermination = host.onTermination(["SIGTERM"], () => controller.abort());
    yield* attempt(() =>
      run([request.service, ...flags], {
        env,
        store: defaultStore(env),
        settings: defaultSettings(env),
        signal: controller.signal,
        target: typeof request.target === "string" ? request.target : undefined,
        plugin: async (name) => loadPlugin(findPlugin(registry, name), registry.context),
        writeError: () => undefined,
        open: (url) => host.write(`${JSON.stringify({ event: "open-url", url })}\n`),
        readSecret: async () => {
          if (typeof request.secret !== "string") throw new UsageError("API key is required");
          return request.secret;
        },
      }),
    ).pipe(Effect.ensuring(Effect.sync(removeTermination)));
    yield* attempt(() => resetDaemonIfRunning(env));
    return null;
  });

export const desktopCommand = (args: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const [action = "", ...rest] = args;
    if (rest.length || !ACTIONS.includes(action)) return yield* Effect.fail(new UsageError(USAGE));
    if (action === "plugins") return yield* writeResult(yield* marketplaceView());
    if (action === "commands") {
      const input = yield* readRequest(host);
      return yield* writeResult(yield* attempt(() => desktopCommandCatalog(input, host)));
    }
    if (action === "plugin-action") {
      const input = yield* readRequest(host);
      return yield* writeResult(yield* marketplaceRequest(input));
    }
    const registry = yield* attempt(async () => discover(await defaultContext(host.env)));
    if (action === "workspace-action") {
      const input = yield* readRequest(host);
      const request = yield* attemptSync(() => decodeWorkspaceAction(input));
      const plugin = yield* attempt(() =>
        loadPlugin(findPlugin(registry, request.service), registry.context),
      );
      return yield* writeResult(yield* workspaceUpdate(plugin, request, defaultSettings(host.env)));
    }
    if (action === "services") {
      const store = defaultStore(host.env);
      const services = yield* attempt(() =>
        Promise.all(registry.plugins.map((found) => desktopService(found, registry, store))),
      );
      return yield* writeResult(services);
    }
    const request = yield* decodeAuthRequest(yield* readRequest(host));
    yield* writeResult(yield* authAction(action, registry, request));
  });
