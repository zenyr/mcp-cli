# Shared execution verification for Bun and txiki.js

This experiment checks whether runtime implementations can be swapped while sharing MCP call logic.
It does not change the actual CLI's default runtime or distribution method.

## Structure

- `runtime.ts`: shared contracts for process input/output streams, local HTTP servers, and file storage
- `bun-runtime.ts`, `txiki-runtime.ts`: implementations for the two runtimes
- `probe.ts`: shared entry point and runtime selection
- `oauth.ts`: metadata discovery, dynamic client registration, PKCE login, and token refresh through the official MCP SDK
- `stdio.ts`: adaptation of runtime process streams to the official SDK's transport contract, plus a local verification server
- `verify.ts`: builds both executables, runs local servers, and compares results

MCP and OAuth logic live in shared code. Runtime-specific differences stay in the two implementation files.
The experiment does not build a compatibility layer that emulates all of Node or Bun.
Shared code has no `node:*`, `bun:*`, or `tjs:*` imports.

## Detection and build-time selection

When `BUILD_RUNTIME` is `auto`, `typeof Bun` selects the implementation.
The verifier also compiles this path into a Bun executable and tests it.
Because the Bun artifact embeds its runtime, automatic detection selects Bun even when Bun is absent from PATH.

Distribution artifacts fix `BUILD_RUNTIME` to `bun` or `txiki`.
Using the build constant directly in dynamic import branches lets the bundler eliminate the unselected branch.
This experiment uses the Bun bundler and checks that the txiki.js JavaScript retains neither the Bun process implementation nor Node imports.
Runtime detection differs from branching determined solely by a build constant.
Automatic detection alone does not guarantee that dependencies of both implementations disappear from the bundle.

The current txiki.js `fetch` implementation requires converting SDK-supplied URL objects to strings inside the adapter.
The SDK's Node-specific `StdioClientTransport` is not reused.
The official SDK retains protocol handling, while shared code replaces only the process stream transport.

## Running the experiment

Run from the repository root.

```sh
bun install --frozen-lockfile
TJS_BIN=/absolute/path/to/tjs bun run --cwd packages/mcp probe:txiki
```

Without `TJS_BIN`, the verifier looks for `tjs` on PATH, then `~/.tinyjs/bin/tjs`.
To verify only stdio, run:

```sh
TJS_BIN=/absolute/path/to/tjs bun run --cwd packages/mcp probe:txiki --stdio-only
```

The verifier requires Bun to build artifacts and run local servers.
The clients and stdio servers under test are compiled executables.
During execution, PATH points to an empty temporary directory, preventing discovery of external Bun or tjs commands.
Temporary build and execution files are removed on completion. Real accounts and user credentials are not used.

Results are returned as JSON on stdout. Any failed check produces exit code 1.
Checks continue even if verification of one runtime fails.
The standard `bun run check` includes only type checking for this experiment. Run the commands above separately for native runtime verification.

## Coverage

- Streamable HTTP with JSON responses: connection, tool listing, and tool calls
- stdio: multiple requests and responses, Korean text and emoji transmitted in 7-byte chunks, and graceful shutdown
- OAuth: metadata discovery, dynamic client registration, S256 PKCE, and a real local callback server
- Token file storage, rereading, refresh, and MCP calls using the refreshed token
- POSIX token file permissions of `0600` and checks for token exposure on stdout
- Rejection of invalid `state` and `access_denied`, without creating credential files for rejected authorization
- Comparison of runtime-fixed builds with the Bun auto-detection build

The verification OAuth server constructs metadata from its own address rather than the request's `Host`.
The installed txiki.js omitted the port from request `Host` values, so host-based routing on real servers requires follow-up verification.

## Observed results

Verification ran on October 20, 2026, on macOS arm64.

HTTP and OAuth checks passed with txiki.js v26.6.0 from the installed tinyjs v0.42.0.
stdio failed because the completion wait did not resolve after the first write was delivered.
This matches the description of [upstream fix c1f48603](https://github.com/saghul/txiki.js/commit/c1f48603f1b22755fc79ab473bbc67d1926793f5).

The same stdio check passed with an executable built separately from upstream source `8a9b604`.
That build exited with code 139 during HTTP calls. The cause was not established.
Both builds report version v26.6.0, so the source revision must also be recorded.
The locally installed tinyjs executable was not replaced.

Bun passed every check in both the runtime-fixed and auto-detection paths.
Executable sizes in this build were 63,069,042 bytes for Bun, 6,356,819 bytes for installed txiki.js, and 6,789,528 bytes for the upstream source build.
These are experiment program sizes, not sizes of full CLI distributions.

Current evidence demonstrates the feasibility of shared contracts and interchangeable runtime implementations.
No single verified txiki.js build passed every check.
Before changing the default distribution, pin the intended revision and rerun the full verification successfully.

## Before applying this to the actual CLI

Plugin discovery, loading generated definitions, interprocess authentication locks, daemon IPC, and Fish Audio's ffmpeg execution have not been ported.
`mem` SQLite is also outside this verification's scope.
SSE responses, automatic refresh based on token expiration, concurrent refresh locks, external browsers, and real service login need separate verification.
The current token storage implementation is experimental and does not replace production credential storage.
