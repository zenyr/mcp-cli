import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Data, Effect } from "effect";
import { UsageError } from "@mcp-cli/core";
import { configPath, type DiscoveryContext } from "../paths";
import { State, decode } from "./schema";

export type MarketContext = Pick<DiscoveryContext, "env" | "home"> & { signal?: AbortSignal };
export const marketRoot = (context: MarketContext): string =>
  join(dirname(configPath(context)), "plugins");
export const objectPath = (context: MarketContext, hash: string): string =>
  join(marketRoot(context), "objects", hash);
export const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");
export const pluginKey = (sourceId: string, id: string): string => digest(`${sourceId}\n${id}`);
export const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
export const readOptional = async (path: string): Promise<string | undefined> =>
  readFile(path, "utf8").catch((error: unknown) => {
    if (missing(error)) return undefined;
    throw error;
  });
export const atomicWrite = async (path: string, text: string, mode = 0o600): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
};
export const readState = async (context: MarketContext): Promise<State> => {
  const text = await readOptional(join(marketRoot(context), "state.json"));
  if (text === undefined) return { schemaVersion: 1, sources: [], installed: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("Invalid plugin state.json.");
  }
  return decode(State, value, "plugin state");
};
export const writeState = (context: MarketContext, state: State): Promise<void> =>
  atomicWrite(join(marketRoot(context), "state.json"), `${JSON.stringify(state, null, 2)}\n`);

export class MarketplaceError extends Data.TaggedError("MarketplaceError")<{
  operation: string;
  message: string;
}> {}
export const attempt = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new MarketplaceError({
        operation,
        message: error instanceof Error ? error.message : "Plugin operation failed.",
      }),
  });

export const transaction = <A>(
  context: MarketContext,
  operation: (signal: AbortSignal) => Promise<A>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        attempt("lock", async () => {
          const root = marketRoot(context);
          await mkdir(root, { recursive: true, mode: 0o700 });
          const path = join(root, "operation.lock");
          let handle;
          try {
            handle = await open(path, "wx", 0o600);
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "EEXIST")
              throw new UsageError(
                `Another plugin operation owns ${path}; check its owner before recovery.`,
              );
            throw error;
          }
          try {
            await handle.writeFile(
              JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
            );
          } catch (error) {
            await rm(path, { force: true });
            throw error;
          } finally {
            await handle.close();
          }
          return () => rm(path, { force: true });
        }),
        (cleanup) => Effect.promise(cleanup),
      );
      return yield* Effect.uninterruptible(
        attempt("plugin management", (signal) => operation(context.signal ?? signal)),
      );
    }),
  );
