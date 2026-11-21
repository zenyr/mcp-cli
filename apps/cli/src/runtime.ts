import type { ServicePlugin } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { resolve } from "node:path";
import { runService, type RuntimeDependencies } from "@mcp-cli/runtime";
import { Effect } from "effect";
import { attempt, attemptSync } from "./attempt";
import { defaultSettings, defaultStore, resolveConnection } from "./auth";
import { callerConnection } from "./caller-connection";
import { DaemonUnavailableError, openDaemonSession, usesDaemon } from "./daemon/client";
import { extensionCacheScope } from "./cache-scope";
import { findPlugin, hostRegistry, loadPlugin } from "./discovery";
import { CliHost, type Host } from "./host";
import { loadManifest } from "./plugins";
import { defaultRepeatGuard } from "./repeat";
import { putBytes } from "./transfer";
import { selectWorkspace } from "./workspaces";

/** Service runtime ports wired to one host's environment, working directory and stdio. */
export const runtimeDependencies = (
  plugin: ServicePlugin,
  host: Host,
  inherited?: string,
  daemon = true,
): RuntimeDependencies => ({
  forWorkspace: async (selector) => {
    const selected = await selectWorkspace(
      plugin,
      selector ?? inherited,
      defaultSettings(host.env),
    );
    const sessionTools = selected.discovery?.tools === "session";
    return {
      ...runtimeDependencies(plugin, host, selected.workspace?.id, daemon),
      workspace: selected.workspace,
      workspaceId: selected.workspace?.legacy
        ? undefined
        : `${plugin.credentialNamespace ?? plugin.name}:${selected.workspace?.id}`,
      open: async (credential) => {
        if (daemon && usesDaemon(host.env)) {
          try {
            return await openDaemonSession(
              plugin.name,
              credential,
              selected.workspace?.id,
              sessionTools,
              {
                env: host.env,
                cwd: host.cwd,
              },
            );
          } catch (error) {
            if (!(error instanceof DaemonUnavailableError)) throw error;
          }
        }
        const config = await resolveConnection(
          selected,
          host.env,
          defaultStore(host.env),
          credential,
        );
        return connect(callerConnection(config, host, selected), { sessionTools });
      },
      cacheScope: (credential) =>
        extensionCacheScope(selected, host.env, defaultStore(host.env), credential),
    };
  },
  open: async () => {
    throw new Error("Select a workspace before opening a connection");
  },
  guard: defaultRepeatGuard(host.env),
  putBytes,
  io: {
    // RuntimeIO.write is synchronous, so a failed write such as a closed pipe is dropped.
    write: (text) => void host.write(`${text}\n`).catch(() => undefined),
    writeError: (text) => host.writeError(`${text}\n`),
    readFile: (path) => Bun.file(resolve(host.cwd, path)).text(),
    readStdin: host.readStdin,
    readBytes: (path) => Bun.file(resolve(host.cwd, path)).bytes(),
  },
});

/** Runs one service command and returns its exit status. */
export const serviceCommand = (
  service: string,
  args: string[],
): Effect.Effect<number, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const registry = yield* hostRegistry;
    const found = yield* attemptSync(() => findPlugin(registry, service));
    const plugin = yield* attempt(() => loadPlugin(found, registry.context));
    const manifest = yield* attempt(() => loadManifest(registry, found));
    return yield* attempt(() =>
      // A daemon discovers plugins from its own install, so it cannot run workspace-only plugins.
      runService(
        plugin,
        manifest,
        args,
        runtimeDependencies(plugin, host, undefined, !found.workspaceOnly),
      ),
    );
  });
