import { UsageError, type WorkspaceAction } from "@mcp-cli/core";
import { formatOutput } from "@mcp-cli/runtime";
import { Effect } from "effect";
import { attempt, attemptSync } from "./attempt";
import { defaultSettings } from "./auth";
import { findPlugin, hostRegistry, loadPlugin } from "./discovery";
import { CliHost, printLine } from "./host";
import { readWorkspaces, workspaceUpdate } from "./workspaces";

const usage =
  "Usage: mcp-cli workspaces <list SERVICE|add SERVICE NAME|rename SERVICE WORKSPACE NAME|default SERVICE WORKSPACE> [--json]";

const workspaceAction = (
  action: string | undefined,
  service: string,
  workspace: string | undefined,
  name: string | undefined,
): WorkspaceAction => {
  if (action === "add" && workspace && !name) return { type: "add", service, name: workspace };
  if (action === "default" && workspace && !name) return { type: "default", service, workspace };
  if (action === "rename" && workspace && name) return { type: "rename", service, workspace, name };
  throw new UsageError(usage);
};

export const workspaceCommand = (argv: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const json = argv.includes("--json");
    const [action, service, workspace, name, ...rest] = argv.filter((arg) => arg !== "--json");
    if (!service || rest.length) return yield* Effect.fail(new UsageError(usage));
    const registry = yield* hostRegistry;
    const found = yield* attemptSync(() => findPlugin(registry, service));
    const plugin = yield* attempt(() => loadPlugin(found, registry.context));
    const settings = defaultSettings(host.env);
    const result =
      action === "list" && !workspace && !name
        ? yield* attempt(() => readWorkspaces(plugin, settings))
        : yield* Effect.flatMap(
            attemptSync(() => workspaceAction(action, service, workspace, name)),
            (request) => workspaceUpdate(plugin, request, settings),
          );
    yield* printLine(formatOutput(result, json));
  });
