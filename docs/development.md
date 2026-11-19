# Development guide

Run commands from the repository root. This project uses Bun workspaces and Turborepo.

## Installation and verification

```sh
bun install
bun run check
bun run format
```

`bun run check` runs linting, code rules, type checking, and tests.
Follow the [desktop guide](../apps/desktop/README.md) for desktop builds.

GitHub Actions runs dependency auditing, `bun run check`, and the CLI build on
pull requests and pushes to `main`. The `verify` check is required for `main`.
Native desktop builds and signature verification run locally before integration.

## Package layout

| Path               | Responsibility                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `packages/core`    | Plugin, manifest, connection, and call contracts; command mappings                           |
| `packages/codegen` | Static code generation from tool definitions; plugin mapping validation                      |
| `packages/runtime` | Command discovery, help, input handling, policies, and output                                |
| `packages/schema`  | JSON Schema input validation                                                                 |
| `packages/mcp`     | stdio and Streamable HTTP connections through the official MCP client; OAuth                 |
| `packages/auth`    | File-based token storage and interprocess locks                                              |
| `plugins/*`        | Service connection settings, command paths, descriptions, and pre-call policies              |
| `apps/cli`         | Plugin discovery, generation, execution, and login commands                                  |
| `apps/mem`         | Original text storage, LLM binary summary trees, startup memory, and original text retrieval |

The shared runtime does not import the MCP SDK directly. Connection implementations convert SDK tool definitions
and results into shared types. Execution tests can inject fake connections using the same call contract.

`apps/cli` and `apps/mem` have independent entry points. `apps/desktop` manages the MCP CLI connection daemon.
`mem` is neither an MCP CLI subcommand nor a plugin.

## Worktrees

Run these two commands to prepare a new worktree. Register them in the T3 Code worktree creation script to run them automatically.

```bash
bun i
bun scripts/worktree.ts init
```

- `init` checks the Bun version and `node_modules`, and installs Git hooks if missing.
  It warns if the global `mcp-cli` link points to this worktree.
- `clean` removes only Git-ignored artifacts such as `node_modules`, `.turbo`, and `dist`.
  It also runs `bun unlink` if the global link points to this worktree.
- `clean` requires `--force` in the main checkout. `--dry-run` only lists removal targets.
- Do not run `bun link` in a worktree. It makes global commands point to that worktree.

## Commit quality checks

The `prepare` script installs Lefthook during `bun install`.
Before a commit, it applies oxfmt to staged files and stages changed files again.
It then runs oxlint and the code rules checker.
Formatting differences alone do not block commits. Fix lint errors before committing.

- Commit messages require a scope. Example: `feat(runtime): add progressive help`.
- Function implementations must use arrow functions.
- `any`, `as unknown`, and non-null assertions are prohibited.
- Generated code is exempt from syntax restrictions and manual formatting.
- Regular source files produce a warning above 350 lines. Tests and fixtures are exempt.
- `bun run check` also runs tests for the quality tools themselves.
