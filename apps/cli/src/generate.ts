import { extractWorkspace } from "./workspace-arguments";
import { selectWorkspace } from "./workspaces";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildArtifacts, decodeSnapshot, isCurrent } from "@mcp-cli/codegen";
import { UsageError, type ServicePlugin } from "@mcp-cli/core";
import { connect } from "@mcp-cli/mcp";
import { Effect } from "effect";
import { attempt, attemptSync } from "./attempt";
import { defaultSettings, defaultStore, resolveConnection } from "./auth";
import { callerConnection, type Caller } from "./caller-connection";
import { findPlugin, hostRegistry, loadPlugin, type Registry } from "./discovery";
import { CliHost, printLine } from "./host";
import { outputFiles } from "./plugins";

const usage = "Usage: mcp-cli generate <service> [--snapshot <path>] [--check]";
type GenerateOptions = { name: string; snapshot?: string; check: boolean };
const options = (args: string[]): GenerateOptions => {
  const [name, ...rest] = args;
  if (!name || name.startsWith("-")) throw new UsageError(usage);
  let snapshot: string | undefined;
  let check = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--check" && !check) check = true;
    else if (flag === "--snapshot" && snapshot === undefined) {
      const path = rest[++i];
      if (!path || path.startsWith("--")) throw new UsageError("Missing snapshot path");
      snapshot = path;
    } else throw new UsageError(`Unknown or repeated generation option: ${flag}`);
  }
  return { name, snapshot, check };
};
const readExisting = async (path: string): Promise<string | undefined> => {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : undefined;
};

const writeAtomically = async (path: string, text: string): Promise<void> => {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await Bun.write(temporary, text);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
};

const liveTools = async (plugin: ServicePlugin, workspace: string | undefined, caller: Caller) => {
  const { env } = caller;
  const scoped = await selectWorkspace(plugin, workspace, defaultSettings(env));
  const config = await resolveConnection(scoped, env, defaultStore(env));
  const session = await connect(callerConnection(config, caller, scoped));
  try {
    return await session.listTools();
  } finally {
    await session.close();
  }
};

/** Generates or checks one plugin's files against a registry. */
export const generate = (
  args: string[],
  registry: Registry,
): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const selected = yield* attemptSync(() => extractWorkspace(args));
    const config = yield* attemptSync(() => options(selected.args));
    const discovered = yield* attemptSync(() => findPlugin(registry, config.name));
    const plugin = yield* attempt(() => loadPlugin(discovered, registry.context));
    const snapshot = config.snapshot && resolve(host.cwd, config.snapshot);
    const tools = yield* attempt(async () =>
      snapshot
        ? decodeSnapshot(await Bun.file(snapshot).json())
        : liveTools(plugin, selected.workspace, host),
    );
    const built = yield* attempt(() => buildArtifacts(plugin, tools));
    const output = yield* attempt(() => outputFiles(registry, discovered));
    if (config.check) {
      const existing = yield* attempt(async () => ({
        snapshot: await readExisting(output.snapshot),
        module: await readExisting(output.module),
      }));
      if (!isCurrent(existing, built))
        return yield* Effect.fail(new Error(`Generated files are stale: ${config.name}`));
      return yield* printLine(`Generated files are current: ${config.name}`);
    }
    yield* attempt(async () => {
      await mkdir(dirname(output.module), { recursive: true });
      await writeAtomically(output.snapshot, built.snapshot);
      await writeAtomically(output.module, built.module);
    });
    yield* printLine(`Generated ${output.module}`);
  });

/** The `generate` command against the host's plugin registry. */
export const generateCommand = (args: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.flatMap(hostRegistry, (registry) => generate(args, registry));
