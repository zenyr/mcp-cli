import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  definePlugin,
  isRecord,
  UsageError,
  type ServicePlugin,
  type Connection,
} from "@mcp-cli/core";
import { safePath } from "./archive";
import { standalone } from "./commands";
import type { Installed } from "./schema";

export const loadManagedPlugin = async (
  installed: Installed,
  directory: string,
  env = process.env,
  runtimeDirectory?: string,
): Promise<ServicePlugin> => {
  if (!installed.enabled) throw new UsageError(`Plugin is disabled: ${installed.metadata.service}`);
  const manifest = installed.manifest;
  const credentialNamespace =
    installed.sourceId === "builtin" ? undefined : `plugin-${installed.key}`;
  const impl = manifest.implementation;
  if (impl.type === "module") {
    const imported: unknown = await import(
      pathToFileURL(join(directory, safePath(impl.entry))).href
    );
    const plugin = isRecord(imported) ? imported.default : undefined;
    if (
      !isRecord(plugin) ||
      plugin.name !== manifest.service ||
      typeof plugin.connection !== "function"
    )
      throw new UsageError("Plugin module does not match its manifest.");
    return { ...plugin, credentialNamespace } as ServicePlugin;
  }
  return definePlugin({
    name: manifest.service,
    summary: manifest.description,
    credentialNamespace,
    commands:
      manifest.commands &&
      Object.fromEntries(
        Object.entries(manifest.commands).map(([name, command]) => [
          name,
          {
            ...command,
            path: [...command.path],
            examples: command.examples && [...command.examples],
            rules: command.rules && [...command.rules],
          },
        ]),
      ),
    groups: manifest.groups,
    quickstart: manifest.quickstart?.map((item) => ({ ...item })),
    auth:
      impl.auth?.type === "oauth"
        ? { ...impl.auth, scopes: impl.auth.scopes && [...impl.auth.scopes] }
        : impl.auth,
    connection: async (): Promise<Connection> => {
      const server = impl.server;
      if (server.type === "http") return { type: "http", url: server.url };
      const entry = join(directory, safePath(server.entry));
      const home = join(directory, "data");
      await mkdir(home, { recursive: true, mode: 0o700 });
      let command: string;
      let args: string[];
      if (server.runtime === "bun") {
        command = process.execPath;
        args = standalone() ? ["--plugin-runtime", entry] : ["run", entry];
      } else if (server.runtime === "native") {
        command = entry;
        args = [];
      } else {
        if (!installed.runtime) throw new UsageError("Managed runtime is not installed.");
        command = join(
          runtimeDirectory ?? join(dirname(directory), installed.runtime.sha256),
          safePath(installed.runtime.executable),
        );
        args = [entry];
      }
      return {
        type: "stdio",
        command,
        args: [...args, ...(server.args ?? [])],
        cwd: directory,
        isolatedEnv: true,
        env: {
          HOME: home,
          USERPROFILE: home,
          PATH: env.PATH ?? "",
          TMPDIR: env.TMPDIR ?? home,
          ...(env.SystemRoot ? { SystemRoot: env.SystemRoot } : {}),
        },
      };
    },
  });
};

export const runPluginRuntime = async (args: string[]): Promise<void> => {
  const [entry, ...rest] = args;
  if (!entry) throw new UsageError("Plugin runtime requires an entry file.");
  process.argv = [process.execPath, entry, ...rest];
  await import(pathToFileURL(entry).href);
};
