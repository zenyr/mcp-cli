import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Schema } from "effect";
import {
  UsageError,
  type ServicePlugin,
  type SettingsStore,
  type WorkspaceAction,
  type WorkspaceRegistry,
} from "@mcp-cli/core";
import { pluginSettings } from "./plugin-credentials";

class WorkspaceStorageError extends Error {
  override name = "WorkspaceStorageError";
}

const workspaceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  legacy: Schema.optional(Schema.Boolean),
});
const registrySchema = Schema.Struct({
  workspaces: Schema.Array(workspaceSchema),
  defaultId: Schema.optional(Schema.String),
});
const initial = (): WorkspaceRegistry => ({
  workspaces: [{ id: "default", name: "default", legacy: true }],
  defaultId: "default",
});
const namePattern = /^[a-z][a-z0-9-]{0,63}$/;
const validateName = (name: string) => {
  if (!namePattern.test(name))
    throw new UsageError(
      "Workspace names must use 1–64 lowercase letters, digits or hyphens, starting with a letter.",
    );
};
const decode = (value: unknown): WorkspaceRegistry => {
  try {
    const result = Schema.decodeUnknownSync(registrySchema)(value);
    if (
      new Set(result.workspaces.map((item) => item.id)).size !== result.workspaces.length ||
      new Set(result.workspaces.map((item) => item.name)).size !== result.workspaces.length ||
      result.workspaces.some((item) =>
        result.workspaces.some((other) => other.id !== item.id && other.id === item.name),
      ) ||
      result.workspaces.some(
        (item) => !namePattern.test(item.name) || !/^(default|[0-9a-f-]{36})$/.test(item.id),
      ) ||
      result.workspaces.filter((item) => item.legacy).length > 1 ||
      result.workspaces.some((item) => (item.legacy === true) !== (item.id === "default")) ||
      (result.defaultId !== undefined &&
        !result.workspaces.some((item) => item.id === result.defaultId))
    )
      throw new Error("Invalid workspace identities");
    return { ...result, workspaces: [...result.workspaces] };
  } catch {
    throw new UsageError("Invalid workspace registry; restore its settings before continuing.");
  }
};
const storage = (plugin: ServicePlugin, settings: SettingsStore) => ({
  store: pluginSettings({ ...plugin, workspace: undefined }, settings),
  key: `${plugin.name}-workspaces`,
});
export const readWorkspaces = async (
  plugin: ServicePlugin,
  settings: SettingsStore,
): Promise<WorkspaceRegistry> => {
  const { store, key } = storage(plugin, settings);
  const value = await store.read(key);
  return value === undefined ? initial() : decode(value);
};

export const selectWorkspace = async (
  plugin: ServicePlugin,
  selector: string | undefined,
  settings: SettingsStore,
): Promise<ServicePlugin> => {
  const registry = await readWorkspaces(plugin, settings);
  const workspace =
    selector !== undefined
      ? registry.workspaces.find((item) => item.id === selector || item.name === selector)
      : (registry.workspaces.find((item) => item.id === registry.defaultId) ??
        (registry.workspaces.length === 1 ? registry.workspaces[0] : undefined));
  if (!workspace)
    throw new UsageError(
      selector !== undefined
        ? `Unknown ${plugin.name} workspace: ${selector}; run mcp-cli workspaces list ${plugin.name}`
        : `Select a ${plugin.name} workspace with -w or set a default`,
    );
  if (!workspace.legacy && !plugin.workspaces)
    throw new UsageError(`${plugin.name} does not support multiple workspaces`);
  return { ...plugin, workspace };
};

/** Applies a workspace action under the settings lock. */
export const workspaceUpdate = (
  plugin: ServicePlugin,
  action: WorkspaceAction,
  settings: SettingsStore,
): Effect.Effect<WorkspaceRegistry, UsageError | WorkspaceStorageError> => {
  const { store, key } = storage(plugin, settings);
  return Effect.tryPromise({
    try: () =>
      store.withLock(key, async () => {
        const registry = await readWorkspaces(plugin, settings);
        if (action.type === "add") {
          if (!plugin.workspaces)
            throw new UsageError(`${plugin.name} does not support multiple workspaces`);
          validateName(action.name);
          if (
            registry.workspaces.some((item) => item.name === action.name || item.id === action.name)
          )
            throw new UsageError(`Workspace already exists: ${action.name}`);
          registry.workspaces.push({ id: randomUUID(), name: action.name });
        } else {
          const workspace = registry.workspaces.find(
            (item) => item.id === action.workspace || item.name === action.workspace,
          );
          if (!workspace) throw new UsageError(`Unknown workspace: ${action.workspace}`);
          if (action.type === "default") registry.defaultId = workspace.id;
          else {
            validateName(action.name);
            if (
              registry.workspaces.some(
                (item) =>
                  item.id !== workspace.id &&
                  (item.name === action.name || item.id === action.name),
              )
            )
              throw new UsageError(`Workspace already exists: ${action.name}`);
            workspace.name = action.name;
          }
        }
        await store.write(key, registry);
        return registry;
      }),
    catch: (error) =>
      error instanceof UsageError
        ? error
        : new WorkspaceStorageError("Could not update workspace settings", { cause: error }),
  });
};

/** Promise form of workspaceUpdate for callers outside Effect. */
export const updateWorkspace = async (
  plugin: ServicePlugin,
  action: WorkspaceAction,
  settings: SettingsStore,
): Promise<WorkspaceRegistry> => {
  const exit = await Effect.runPromiseExit(workspaceUpdate(plugin, action, settings));
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

const actionSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), service: Schema.String, name: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("rename"),
    service: Schema.String,
    workspace: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("default"),
    service: Schema.String,
    workspace: Schema.String,
  }),
]);
export const decodeWorkspaceAction = (value: unknown): WorkspaceAction => {
  try {
    return Schema.decodeUnknownSync(actionSchema)(value);
  } catch {
    throw new UsageError("Invalid workspace action");
  }
};
