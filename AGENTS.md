# Working rules

- Write Korean responses in polite language, starting with a short conclusion.
- Use only `gh` for GitHub operations.
- Serialize Git write operations within the same repository.
- Check all six gates in the `coding-rules` skill before writing code and before committing.
- Implement functions as arrow functions. Generated code is exempt.
- Do not use `any`, `as any`, `as unknown`, or non-null assertions. Generated code is exempt.
- Limit type guards to small utility functions or tests.
- Keep files within a soft cap of 350 lines. Generated code, fixtures, and tests are exempt.
- Keep SDK dependencies in connection implementations. Keep service configuration and policies in plugins.
- Limit each code comment to one sentence.

# Verification and commits

- `bun run check`: oxlint, code rules, type checking, and tests.
- `bun run format`: automatic formatting with oxfmt.
- Lefthook automatically formats staged files and stages them again before commits.
- Fix lint failures after formatting. Do not bypass hooks.
- Use scoped Conventional Commit messages, such as `feat(scope): description`.
- Verify stable changes and commit them in slices.
- Once changes are stable, apply them to the main worktree without a separate request, then verify, build, and push the commits to remote `main`.
- Default verification includes `bun run check`, a CLI build, and, on macOS, `bun run --cwd apps/desktop native:build` and app signature verification.
- For a running app, use the standard build process to shut down, replace, and relaunch it gracefully. Do not overwrite the running executable or force-terminate the app.
- Stop automatic integration, builds, and pushes if the user asks you to stop, verification fails, conflicts remain unresolved, or permissions or environment constraints prevent progress. Report the specific reason and remaining work.
- Do not include or overwrite the user's uncommitted changes without authorization. Do not force-push remote history.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
