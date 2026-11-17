import { Effect } from "effect";

/** Runs a Promise operation and keeps its rejection as the failure, so exit codes still see the original error. */
export const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: operation, catch: (error) => error });

/** Runs a synchronous operation that may throw a usage error and keeps the thrown value as the failure. */
export const attemptSync = <A>(operation: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: operation, catch: (error) => error });
