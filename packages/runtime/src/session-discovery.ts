import { Effect } from "effect";
import {
  credentialSwitches,
  decodeManifest,
  UsageError,
  type GeneratedManifest,
  type ServicePlugin,
} from "@mcp-cli/core";
import { validateTools } from "@mcp-cli/schema";
import { parseArguments } from "./arguments";
import type { RuntimeDependencies } from "./index";

type Run = (
  plugin: ServicePlugin,
  manifest: GeneratedManifest,
  argv: string[],
  ports: RuntimeDependencies,
) => Promise<number>;

const bootstrapNotice =
  "Bootstrap catalog: bundled tools; current account availability requires live discovery.";

export const runSessionService = async (
  plugin: ServicePlugin,
  bootstrap: GeneratedManifest,
  argv: string[],
  ports: RuntimeDependencies,
  run: Run,
): Promise<number> => {
  const credentials = credentialSwitches(plugin.auth);
  const selection = parseArguments(
    argv,
    () => ({}),
    credentials.map(({ flag }) => flag),
  );
  const root =
    !selection.path.length ||
    (selection.path.length === 1 && ["help", "skill"].includes(selection.path[0] ?? ""));
  if (root) {
    const code = await run(plugin, bootstrap, argv, ports);
    ports.io.write(bootstrapNotice);
    return code;
  }
  const selected = ports.forWorkspace ? await ports.forWorkspace(selection.workspace) : ports;
  if (selection.workspace && !ports.forWorkspace && !ports.workspaceId)
    throw new UsageError("This runtime does not support workspace selection");
  const credential = credentials.find(({ flag }) => flag === selection.credential)?.base
    ? undefined
    : selection.credential;
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({ try: () => selected.open(credential), catch: (error) => error }),
      (session) =>
        Effect.tryPromise({
          try: async () => {
            const live = decodeManifest({
              version: 2,
              service: plugin.name,
              tools: await session.listTools(),
            });
            validateTools(live.tools);
            return run(plugin, live, argv, {
              ...selected,
              open: async () => ({ ...session, close: async () => {} }),
            });
          },
          catch: (error) => error,
        }),
      (session) => Effect.promise(() => session.close()),
    ),
  );
};
