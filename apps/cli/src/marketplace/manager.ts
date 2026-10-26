import { realpath, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Schema } from "effect";
import { decodeManifest, UsageError, type MarketplaceAction } from "@mcp-cli/core";
import { revoked } from "./catalog";
import { builtins } from "./builtins";
import { installPath, launcher, syncCommands, userBin } from "./commands";
import { installPackage, packageManifest, prepareRuntime } from "./packages";
import { safePath } from "./archive";
import { loadSource } from "./sources";
import {
  digest,
  pluginKey,
  readState,
  transaction,
  writeState,
  type MarketContext,
} from "./storage";
import { PackageManifest, decode, selectArtifact, type Installed, type State } from "./schema";

export const Action = Schema.Union([
  Schema.Struct({ type: Schema.Literal("source.add"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("source.refresh"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("source.remove"), id: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("plugin.install"),
    sourceId: Schema.String,
    pluginId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("plugin.enable"),
    key: Schema.String,
    enabled: Schema.Boolean,
    allowLocalCode: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("plugin.remove"), key: Schema.String }),
  Schema.Struct({ type: Schema.Literal("plugin.link"), directory: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("commands.install"),
    directory: Schema.optional(Schema.String),
  }),
]);
export type Action = MarketplaceAction;
export type ManagerContext = MarketContext & { reset: () => Promise<void> };
const reserved = new Set([
  "mcp-cli",
  "help",
  "generate",
  "plugins",
  "login",
  "logout",
  "auth",
  "desktop",
  "daemon",
]);
const persist = async (context: ManagerContext, previous: State, next: State) => {
  const result = await syncCommands(previous, next, context);
  try {
    await writeState(context, result.state);
  } catch (error) {
    await result.rollback();
    throw error;
  }
  if (JSON.stringify(previous.installed) !== JSON.stringify(next.installed)) await context.reset();
};

const assertService = (state: State, service: string, key: string) => {
  if (reserved.has(service)) throw new UsageError(`Reserved command name: ${service}`);
  if (state.installed.some((item) => item.key !== key && item.metadata.service === service))
    throw new UsageError(`Another installed plugin owns ${service}.`);
};

const link = async (
  state: State,
  directory: string,
  context: ManagerContext,
  signal: AbortSignal,
): Promise<Installed> => {
  if (!isAbsolute(directory)) throw new UsageError("Development folder must be an absolute path.");
  const path = await realpath(directory);
  const text = await readFile(join(path, "plugin.json"), "utf8");
  const manifest = decode(PackageManifest, JSON.parse(text), "plugin.json");
  const generated = decodeManifest(JSON.parse(await readFile(join(path, "manifest.json"), "utf8")));
  const implementation = manifest.implementation;
  const entry =
    implementation.type === "module"
      ? implementation.entry
      : implementation.server.type === "stdio"
        ? implementation.server.entry
        : undefined;
  const files = new Map<string, Uint8Array>([
    ["plugin.json", new TextEncoder().encode(text)],
    ["manifest.json", new TextEncoder().encode(JSON.stringify(generated))],
  ]);
  if (entry) files.set(safePath(entry), await readFile(join(path, safePath(entry))));
  packageManifest(files);
  if (generated.service !== manifest.service)
    throw new UsageError("Development manifest has a different service.");
  const key = pluginKey("development", path);
  assertService(state, manifest.service, key);
  const artifact = {
    url: pathToFileURL(path).href,
    sha256: digest(text),
    platform: "any",
    arch: "any",
  } as const;
  return {
    key,
    sourceId: "development",
    commit: "working-tree",
    manifest,
    developmentPath: path,
    runtime: await prepareRuntime(context, manifest, signal, true),
    artifact,
    enabled: false,
    metadata: {
      id: manifest.id,
      service: manifest.service,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      permissions: manifest.permissions,
      artifacts: [artifact],
    },
  };
};

export const manage = (context: ManagerContext, input: unknown) =>
  transaction(context, async (signal) => {
    const action = decode(Action, input, "plugin action");
    signal.throwIfAborted();
    const state = await readState(context);
    const sources = state.sources;
    let next: State = state;
    let message = "완료했습니다.";
    switch (action.type) {
      case "source.add": {
        const source =
          action.url === "builtin"
            ? await builtins()
            : await loadSource(context, action.url, signal);
        if (!source) throw new UsageError("The recommended catalog is not included in this app.");
        if (state.sources.some((item) => item.id === source.id))
          throw new UsageError("Catalog is already registered.");
        next = { ...state, sources: [...state.sources, source] };
        break;
      }
      case "source.refresh": {
        const source = state.sources.find((item) => item.id === action.id);
        if (!source) throw new UsageError("Catalog not found.");
        const updated =
          source.url === "builtin"
            ? await builtins()
            : await loadSource(context, source.url, signal);
        if (!updated) throw new UsageError("The recommended catalog is not included in this app.");
        const updatedSources = state.sources.map((item) =>
          item.id === action.id ? updated : item,
        );
        next = {
          ...state,
          sources: updatedSources,
          installed: state.installed.map((plugin) =>
            revoked(updatedSources, plugin) ? { ...plugin, enabled: false } : plugin,
          ),
        };
        break;
      }
      case "source.remove":
        if (state.installed.some((item) => item.sourceId === action.id))
          throw new UsageError("Remove this catalog's installed plugins first.");
        next = { ...state, sources: state.sources.filter((item) => item.id !== action.id) };
        break;
      case "plugin.install": {
        const source = sources.find((item) => item.id === action.sourceId);
        const plugin = source?.catalog.plugins.find((item) => item.id === action.pluginId);
        if (!source || !plugin) throw new UsageError("Catalog plugin not found.");
        const key = pluginKey(source.id, plugin.id);
        assertService(state, plugin.service, key);
        const artifact = selectArtifact(plugin.artifacts);
        if (
          source.catalog.revoked?.some(
            (item) => item.id === plugin.id && item.sha256 === artifact.sha256,
          )
        )
          throw new UsageError("This package is revoked.");
        const installed = await installPackage(
          context,
          plugin,
          signal,
          source.url === "builtin" || source.url.startsWith("file:"),
        );
        const record: Installed = {
          ...installed,
          key,
          sourceId: source.id,
          commit: source.commit,
          metadata: plugin,
          enabled: false,
        };
        next = {
          ...state,
          installed: [...state.installed.filter((item) => item.key !== key), record],
        };
        message = "설치했습니다. 권한을 확인하고 활성화해 주세요.";
        break;
      }
      case "plugin.link": {
        const record = await link(state, action.directory, context, signal);
        next = {
          ...state,
          installed: [...state.installed.filter((item) => item.key !== record.key), record],
        };
        break;
      }
      case "plugin.enable": {
        const plugin = state.installed.find((item) => item.key === action.key);
        if (!plugin) throw new UsageError("Installed plugin not found.");
        if (action.enabled && revoked(sources, plugin))
          throw new UsageError("This package is revoked.");
        if (action.enabled && plugin.metadata.permissions.localCode && !action.allowLocalCode)
          throw new UsageError(
            "This plugin executes code with your user permissions; explicit approval is required.",
          );
        next = {
          ...state,
          installed: state.installed.map((item) =>
            item.key === action.key ? { ...item, enabled: action.enabled } : item,
          ),
        };
        break;
      }
      case "plugin.remove":
        next = { ...state, installed: state.installed.filter((item) => item.key !== action.key) };
        break;
      case "commands.install": {
        const directory = action.directory ?? state.commands?.directory ?? userBin(context);
        if (!isAbsolute(directory))
          throw new UsageError("Command directory must be an absolute path.");
        next = {
          ...state,
          commands: { directory, launcher: launcher(), receipts: state.commands?.receipts ?? {} },
        };
        message = await installPath(context, directory);
        break;
      }
    }
    signal.throwIfAborted();
    await persist(context, state, next);
    return { message };
  });
