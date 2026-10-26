import { Context, Data, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { deferred, equal, rejects, type RuntimeCase } from "./contract";

class Denied extends Data.TaggedError("Denied")<{ operation: string }> {}
const Value = Context.Service<{ read: () => Effect.Effect<number> }>("desktop/runtime-test/Value");

export const effectCases: RuntimeCase[] = [
  {
    name: "Effect keeps defects separate from typed failures",
    run: async () => {
      let recovered = false;
      const operation: Effect.Effect<number, Denied> = Effect.die(new Error("defect"));
      const result = await Effect.runPromiseExit(
        operation.pipe(
          Effect.catchTag("Denied", () => {
            recovered = true;
            return Effect.succeed(0);
          }),
        ),
      );
      equal(recovered, false);
      equal(Exit.isFailure(result), true);
    },
  },
  {
    name: "Effect preserves and handles typed failures",
    run: async () => {
      const operation: Effect.Effect<number, Denied> = Effect.fail(
        new Denied({ operation: "read" }),
      );
      const result = await Effect.runPromise(
        operation.pipe(
          Effect.catchTag("Denied", (error) => Effect.succeed(error.operation.length)),
        ),
      );
      equal(result, 4);
    },
  },
  {
    name: "Effect dependencies are replaceable through Layers",
    run: async () => {
      const operation = Effect.gen(function* () {
        const value = yield* Value;
        return yield* value.read();
      });
      equal(
        await Effect.runPromise(
          operation.pipe(Effect.provide(Layer.succeed(Value, { read: () => Effect.succeed(42) }))),
        ),
        42,
      );
    },
  },
  {
    name: "Effect scopes finalize resources after success and failure",
    run: async () => {
      for (const fail of [false, true]) {
        const events: string[] = [];
        const operation = Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                events.push("open");
              }),
              () =>
                Effect.sync(() => {
                  events.push("close");
                }),
            );
            if (fail) return yield* Effect.fail(new Denied({ operation: "read" }));
            return 7;
          }),
        );
        const result = await Effect.runPromiseExit(operation);
        equal(Exit.isFailure(result), fail);
        equal(events, ["open", "close"]);
      }
    },
  },
  {
    name: "Effect interruption aborts the underlying Promise and finalizes",
    run: async () => {
      const started = deferred();
      let aborted = false;
      let finalized = false;
      const operation = Effect.tryPromise({
        try: (signal) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            );
            started.resolve();
          }),
        catch: () => new Denied({ operation: "cancel" }),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      );
      const fiber = Effect.runFork(operation);
      try {
        await started.promise;
      } finally {
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
      equal(aborted, true);
      equal(finalized, true);
    },
  },
  {
    name: "Effect Schema accepts owned values and rejects invalid input",
    run: async () => {
      const decoder = Schema.decodeUnknownEffect(
        Schema.Struct({ name: Schema.String, count: Schema.Number }),
      );
      equal(await Effect.runPromise(decoder({ name: "test", count: 3 })), {
        name: "test",
        count: 3,
      });
      await rejects(Effect.runPromise(decoder({ name: "test", count: "invalid" })));
    },
  },
  {
    name: "Effect scheduler completes a timed fiber",
    run: async () => {
      equal(await Effect.runPromise(Effect.sleep(1).pipe(Effect.as("done"))), "done");
    },
  },
];
