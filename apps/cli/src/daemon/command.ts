import { formatOutput } from "@mcp-cli/runtime";
import { UsageError } from "@mcp-cli/core";
import { Effect } from "effect";
import { CliHost, printLine } from "../host";
import { daemonRequest, daemonStatus } from "./client";
import { prepareOwnership } from "./ownership";
import { daemonDirectory } from "./endpoint";
import { startDaemon } from "./server";

const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: operation, catch: (error) => error });

// Serves until a termination signal or an IPC stop, and the scope finalizer stops the server.
const serve = (directory: string, ready: Effect.Effect<void, never, CliHost>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* CliHost;
      const daemon = yield* Effect.acquireRelease(
        attempt(() => startDaemon(directory)),
        (owned) => Effect.ignore(attempt(() => owned.stop())),
      );
      yield* ready;
      yield* Effect.callback<void>((resume) => {
        const remove = host.onTermination(["SIGTERM", "SIGINT"], () => resume(Effect.void));
        void daemon.stopRequested.then(() => resume(Effect.void));
        return Effect.sync(remove);
      });
      yield* attempt(() => daemon.stop());
    }),
  );

export const daemonCommand = (argv: string[]): Effect.Effect<void, unknown, CliHost> =>
  Effect.gen(function* () {
    const host = yield* CliHost;
    const json = argv.includes("--json");
    const args = argv.filter((arg) => arg !== "--json");
    const write = (value: unknown) => printLine(json ? JSON.stringify(value) : formatOutput(value));
    const [action, ...rest] = args;
    if (rest.length || !action || !["start", "status", "reset", "stop", "recover"].includes(action))
      return yield* Effect.fail(
        new UsageError("Usage: mcp-cli daemon <start|status|reset|stop|recover>"),
      );
    const directory = daemonDirectory(host.env);
    if (action === "recover") return yield* attempt(() => prepareOwnership(directory));
    if (action === "start")
      return yield* serve(directory, write({ event: "ready", pid: process.pid }));
    const result = yield* attempt(() =>
      action === "status" ? daemonStatus(directory) : daemonRequest(action, {}, directory),
    );
    yield* write(result);
  });
