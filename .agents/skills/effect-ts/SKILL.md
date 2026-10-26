---
name: effect-ts
description: Apply this repository's Effect-TS principles when designing, implementing, reviewing, or testing TypeScript application flows, typed errors, dependencies, concurrency, and resource lifecycles.
---

# Effect-TS principles

Effect is the preferred foundation for new asynchronous application flows in this repository.
Use it actively when changing orchestration, dependencies, error handling, or resource ownership.
Keep pure calculations pure and preserve established external contracts during incremental adoption.
Do not expand a narrow task into an unrelated repository-wide rewrite.

## Deep modules and hexagonal boundaries

- Give callers a small interface that expresses a complete operation and its failure modes.
- Hide callback servers, credential refresh, coordination, and cleanup behind that interface.
- Express application dependencies through Effect services and provide implementations with Layers at entry points.
- Introduce a port for a real replacement need, such as production storage versus test storage.
- Keep SDK-specific objects, platform APIs, and raw Promise operations inside implementations of those ports.
- Keep domain values independent of platform implementations; do not require a runtime for pure transformations.
- Avoid forwarding-only modules and a separate service for every helper function.

## Errors and external boundaries

- Declare expected failure types in the Effect error channel, using discriminated errors with useful domain fields.
- Keep defects, expected failures, and interruption distinct; never convert every Cause into a generic business error.
- Map unknown SDK, filesystem, and network exceptions at the implementation that understands them.
- Catch specific failures where recovery is meaningful; handle the final Cause at an application entry point.
- Decode owned configuration and IPC data with Schema; preserve external JSON Schema contracts when those require AJV.
- Serialize explicit error envelopes across processes; do not rely on class identity surviving JSON.
- Keep secrets redacted in errors, logs, traces, and diagnostics; do not attach raw request headers or token responses.

## Resources and concurrency

- Model owned resources with Scope and acquireRelease or the matching scoped API.
- Keep runtime execution at CLI, server, worker, or IPC entry points; avoid nested runPromise calls inside application logic.
- Connect interruption to the underlying operation's AbortSignal or cancellation mechanism.
- Finishing a caller's wait does not prove that the underlying process or operation stopped.
- Prefer structured child fibers, Deferred, and bounded concurrency over detached tasks and hand-written promise races.
- Use retry schedules only for classified, retryable failures; do not replay writes with an unknown remote outcome.
- An Effect semaphore coordinates fibers in one process; it does not replace filesystem or OS locks between processes.
- Preserve process-lock ownership and atomicity even when Effect manages acquisition and cleanup.

## Runtime and version discipline

- Use the repository's pinned Effect version and its matching API documentation; do not mix v3 and v4 examples.
- Declare Effect in the workspace that imports it; use a runtime dependency when application code starts using it.
- Check installed declarations when an API name or interruption guarantee is uncertain.
- The only exception to arrow-only functions is a synchronous generator callback passed directly to imported Effect.gen.
- Treat tinyjs/TxikiJS compatibility as a testable property, not an assumed failure or assumed success.
- Keep Bun/Node implementations out of portable shared modules and the tinyjs backend bundle.

## Tests and adoption

- Keep normal development tests on Bun: bun run check or the relevant focused bun test command.
- Put portable backend behavior in the shared runtime suite so Bun and TxikiJS run the same assertions.
- Run bun run --cwd apps/desktop test:txiki when touching portable runtime behavior or Effect integration.
- Native builds run that suite before building or replacing an app; failure must stop replacement.
- Add tests for expected errors, defects, interruption, finalization, and dependency replacement where relevant.
- Use deterministic clocks and synchronization for Effect concurrency tests; keep real process tests for OS coordination.
- A passing small suite establishes only its covered features; add coverage as new Effect/platform features are adopted.
- Measure startup, bundle size, and resource behavior before claiming a performance improvement.

References: [Effect v4 documentation](https://effect.website/docs/v4/getting-started),
[typed errors](https://effect.website/docs/v4/error-management/expected-errors),
[resource scopes](https://effect.website/docs/v4/resource-management/scope),
[Layers](https://effect.website/docs/v4/requirements-management/layers).
