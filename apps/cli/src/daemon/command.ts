import { formatOutput } from "@mcp-cli/runtime";
import { UsageError } from "@mcp-cli/core";
import { Effect } from "effect";
import { attempt } from "../attempt";
import { CliHost, printLine } from "../host";
import { daemonRequest, daemonStatus } from "./client";
import { prepareOwnership } from "./ownership";
import { daemonDirectory } from "./endpoint";
import { startDaemon } from "./server";

// Serves until a termination signal or an IPC stop, and the scope finalizer stops the server.
const serve = (directory: string, ready: Effect.Effect<void, never, CliHost>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const host = yield* CliHost;
      const daemon = yield* Effect.acquireRelease(
        attempt(() => startDaemon(directory)),
        (owned) => Effect.ignore(attempt(() => owned.stop())),
      );
      const terminated = Promise.withResolvers<void>();
      const remove = host.onTermination(["SIGTERM", "SIGINT"], () => terminated.resolve());
      yield* Effect.addFinalizer(() => Effect.sync(remove));
      yield* ready;
      yield* Effect.promise(() => Promise.race([terminated.promise, daemon.stopRequested]));
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
