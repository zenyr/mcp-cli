# Working rules

- Korean replies: polite, brief conclusion first.
- GitHub: `gh` only. Serialize Git writes per repository.
- Before coding and committing: check all six `coding-rules` gates.
- Functions: arrows only. No `any`, `as any`, `as unknown`, or non-null assertions. Generated code exempt.
- Type guards: limited to small utilities or tests.
- File soft cap: 350 lines. Generated code, fixtures, tests exempt.
- SDK dependencies: connection implementations. Service config/policies: plugins.
- Code comments: one sentence maximum each.

# Verification and commits

- `bun run check`: oxlint, code rules, typecheck, tests. `bun run format`: oxfmt autofix.
- Lefthook formats and restages staged files before commit. Fix remaining lint failures. Never bypass hooks.
- Scoped Conventional Commits, e.g. `feat(scope): description`. Verify stable changes, commit by slice.
- Stable changes: apply to main worktree without further request, verify/build, push commits to remote `main`.
- Default verification: `bun run check`, CLI build; on macOS, `bun run --cwd apps/desktop native:build` and app signature verification.
- Running apps: standard build's graceful shutdown → replacement → relaunch. Never overwrite running executables or force-terminate apps.
- Stop automatic integration/build/push on user stop, failed verification, unresolved conflicts, or blocking permission/environment constraints. Report cause and remaining work.
- Never include/overwrite user uncommitted changes without authorization or force-push remote history.

<!-- BEGIN:turborepo-agent-rules -->

# Version-specific Turborepo

Turborepo config, task behavior, and CLI vary by installed version and may differ from training data. Resolve `turbo` from this directory or the relevant workspace; monorepo roots may not expose it. Example from a dependent workspace: `node -p "require.resolve('turbo/package.json')"`.

Before changing Turborepo config/commands: read installed package's `docs/README.md`, then relevant `docs/` pages. Heed deprecations. Bundled docs match the installed version and work offline.

When detecting an AI agent, `turbo` writes/re-adds this block before repository-scoped commands. Upstream template: `crates/turborepo-cli/src/cli/agent_guidance.rs`. With updates enabled, deleting it triggers re-addition on a later qualifying invocation. Opt out: `"agentGuidance": false` in root `turbo.json`/`turbo.jsonc`; existing blocks remain. Commit the block to avoid uncommitted changes on the next agent invocation.
<!-- END:turborepo-agent-rules -->
