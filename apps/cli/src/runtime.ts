import type { ServicePlugin } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import type { RuntimeDependencies } from "@mcp-cli/runtime";
import { defaultStore, resolveConnection } from "./auth";
import { DaemonUnavailableError, openDaemonSession, usesDaemon } from "./daemon/client";
import { extensionCacheScope } from "./cache-scope";
import { defaultRepeatGuard } from "./repeat";
import { putBytes } from "./transfer";
import { selectWorkspace } from "./workspaces";

export const runtimeDependencies = (
  plugin: ServicePlugin,
  inherited?: string,
): RuntimeDependencies => ({
  forWorkspace: async (selector) => {
    const selected = await selectWorkspace(plugin, selector ?? inherited);
    return {
      ...runtimeDependencies(plugin, selected.workspace?.id),
      workspace: selected.workspace,
      workspaceId: selected.workspace?.legacy
        ? undefined
        : `${plugin.credentialNamespace ?? plugin.name}:${selected.workspace?.id}`,
      open: async (credential) => {
        if (usesDaemon()) {
          try {
            return await openDaemonSession(
              plugin.name,
              credential,
              selected.workspace?.id,
              selected.discovery?.tools === "session",
            );
          } catch (error) {
            if (!(error instanceof DaemonUnavailableError)) throw error;
          }
        }
        return connect(await resolveConnection(selected, process.env, defaultStore(), credential), {
          sessionTools: selected.discovery?.tools === "session",
        });
      },
      cacheScope: (credential) =>
        extensionCacheScope(selected, process.env, defaultStore(), credential),
    };
  },
  open: async () => {
    throw new Error("Select a workspace before opening a connection");
  },
  guard: defaultRepeatGuard(process.env),
  putBytes,
  io: {
    write: (text) => console.log(text),
    writeError: (text) => console.error(text),
    readFile: (path) => Bun.file(path).text(),
    readStdin: () => Bun.stdin.text(),
    readBytes: (path) => Bun.file(path).bytes(),
  },
});
