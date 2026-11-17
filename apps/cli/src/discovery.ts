import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord, UsageError, type ServicePlugin } from "@mcp-cli/core";
import { Effect } from "effect";
import { attempt } from "./attempt";
import { CliHost } from "./host";
import { bundledPlugins, type BundledPlugin } from "./bundled";
import { readConfig, type PluginReference, type UserConfig } from "./config";
import { nodeModulePackages, readPackage, workspacePackages, type PackageInfo } from "./packages";
import { configPath, defaultContext, type DiscoveryContext } from "./paths";
import { readState, objectPath } from "./marketplace/storage";
import { loadManagedPlugin } from "./marketplace/runtime";
import type { Installed } from "./marketplace/schema";
import { builtins } from "./marketplace/builtins";

/** Top-level CLI commands that a service name may not shadow. */
export const TOP_LEVEL_COMMANDS: readonly string[] = [
  "help",
  "generate",
  "plugins",
  "workspaces",
  "login",
  "logout",
  "auth",
  "desktop",
  "daemon",
  "mcp-cli",
];
export type PluginSource =
  | "workspace"
  | "node_modules"
  | "config"
  | "bundled"
  | "installed"
  | "development";
export type DiscoveredPlugin = {
  service: string;
  packageName: string;
  dir: string;
  entry: string;
  source: PluginSource;
  /** Where discovery found the package, for listings and duplicate errors. */
  origin: string;
  bundled?: BundledPlugin;
  installed?: Installed;
  runtimeDirectory?: string;
};
export type Registry = { context: DiscoveryContext; plugins: DiscoveredPlugin[] };
type Candidate = { info: PackageInfo; source: PluginSource; origin: string };

const isServicePlugin = (value: unknown): value is ServicePlugin =>
  isRecord(value) && typeof value.name === "string" && typeof value.connection === "function";

export const importPlugin = async (entry: string): Promise<ServicePlugin> => {
  const module: unknown = await import(pathToFileURL(entry).href);
  const plugin = isRecord(module) ? module.default : undefined;
  if (!isServicePlugin(plugin)) throw new Error(`Plugin module has no default plugin: ${entry}`);
  return plugin;
};

const configCandidate = async (
  reference: PluginReference,
  index: number,
  config: UserConfig,
  context: DiscoveryContext,
): Promise<Candidate> => {
  const fail = (reason: string) =>
    new UsageError(`Invalid config ${config.path}: plugins[${index}] ${reason}`);
  const dirs =
    reference.kind === "path"
      ? [reference.dir]
      : [join(dirname(config.path), "node_modules"), ...context.nodeModules].map((root) =>
          join(root, reference.value),
        );
  for (const dir of dirs) {
    const info = await readPackage(dir);
    if (info) return { info, source: "config", origin: `config ${config.path}` };
  }
  throw reference.kind === "path"
    ? fail(`is not a package directory: ${reference.dir}`)
    : fail(`package not found: ${reference.value}`);
};

const candidates = async (context: DiscoveryContext): Promise<Candidate[]> => {
  const root = context.workspaceRoot;
  // "1" adds hidden contract plugins; "only" keeps just them so CLI tests never load real plugins.
  const internal = context.env.MCP_CLI_INTERNAL_PLUGINS;
  const workspace = root
    ? (await workspacePackages(root)).filter((info) =>
        internal === "only" ? info.hidden : internal === "1" || !info.hidden,
      )
    : [];
  const installed = await Promise.all(
    context.nodeModules.map(async (dir) =>
      (await nodeModulePackages(dir)).map((info): Candidate => ({
        info,
        source: "node_modules",
        origin: `node_modules ${dir}`,
      })),
    ),
  );
  const path = configPath(context);
  const config = await readConfig(path, context.home, Boolean(context.env.MCP_CLI_CONFIG));
  const configured = await Promise.all(
    config.plugins.map((reference, i) => configCandidate(reference, i, config, context)),
  );
  return [
    ...workspace.map((info): Candidate => ({
      info,
      source: "workspace",
      origin: `workspace ${root}`,
    })),
    ...installed.flat(),
    ...configured,
  ];
};

const serviceOf = async ({ info, origin }: Candidate): Promise<string> => {
  const service = info.service ?? (await importPlugin(info.entry)).name;
  const where = `${info.name} (${origin})`;
  if (!/^[a-z][a-z0-9-]*$/.test(service))
    throw new Error(`Invalid service name ${JSON.stringify(service)} in ${where}`);
  if (TOP_LEVEL_COMMANDS.includes(service))
    throw new Error(`Service name ${service} in ${where} is a reserved mcp-cli command`);
  return service;
};

// The same package reached through several roots (workspace links, config) counts once.
export const discover = async (context: DiscoveryContext): Promise<Registry> => {
  const state = await readState(context);
  const builtin = await builtins();
  const seen = new Set<string>();
  const unique = (await candidates(context)).filter(({ info }) => {
    if (seen.has(info.dir)) return false;
    seen.add(info.dir);
    return true;
  });
  const resolved = await Promise.all(
    unique.map(async (candidate) => ({ ...candidate, service: await serviceOf(candidate) })),
  );
  const plugins: DiscoveredPlugin[] = bundledPlugins().map((bundled) => ({
    service: bundled.plugin.name,
    packageName: bundled.packageName,
    dir: "(bundled)",
    entry: "",
    source: "bundled",
    origin: "bundled executable",
    bundled,
  }));
  for (const installed of state.installed) {
    const source =
      installed.sourceId === "builtin"
        ? builtin
        : state.sources.find((item) => item.id === installed.sourceId);
    const revoked = source?.catalog.revoked?.some(
      (item) => item.id === installed.metadata.id && item.sha256 === installed.artifact.sha256,
    );
    if (!installed.enabled || revoked) continue;
    const dir = installed.developmentPath ?? objectPath(context, installed.artifact.sha256);
    plugins.push({
      service: installed.metadata.service,
      packageName: installed.metadata.id,
      dir,
      entry: "",
      source: installed.developmentPath ? "development" : "installed",
      origin: installed.sourceId,
      installed,
      runtimeDirectory: installed.runtime
        ? objectPath(context, installed.runtime.sha256)
        : undefined,
    });
  }
  for (const { info, source, origin, service } of resolved) {
    if (state.installed.some((item) => item.metadata.service === service)) continue;
    const other = plugins.find((plugin) => plugin.service === service);
    if (other)
      throw new Error(
        `Duplicate service ${service}: ${other.packageName} at ${other.dir} (${other.origin}) and ${info.name} at ${info.dir} (${origin})`,
      );
    plugins.push({
      service,
      packageName: info.name,
      dir: info.dir,
      entry: info.entry,
      source,
      origin,
    });
  }
  return { context, plugins: plugins.sort((a, b) => a.service.localeCompare(b.service)) };
};

/** Discovers plugins from the host environment. */
export const hostRegistry: Effect.Effect<Registry, unknown, CliHost> = Effect.flatMap(
  CliHost,
  (host) => attempt(async () => discover(await defaultContext(host.env))),
);

export const findPlugin = (registry: Registry, name: string): DiscoveredPlugin => {
  const found = registry.plugins.find((plugin) => plugin.service === name);
  if (!found) throw new UsageError(`Unknown service: ${name}`);
  return found;
};

export const loadPlugin = async (
  plugin: DiscoveredPlugin,
  context: DiscoveryContext,
): Promise<ServicePlugin> => {
  if (plugin.installed)
    return loadManagedPlugin(plugin.installed, plugin.dir, context.env, plugin.runtimeDirectory);
  const loaded = plugin.bundled?.plugin ?? (await importPlugin(plugin.entry));
  if (loaded.name !== plugin.service)
    throw new Error(
      `Plugin ${plugin.packageName} declares service ${plugin.service} but exports plugin ${loaded.name}`,
    );
  return loaded;
};
