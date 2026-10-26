# Slack extension validation record

Validation date: 2026-10-22. Environment: macOS.
Implementation and validation took place in the current mcp-cli worktree.
No repository on another machine or external slack-cli source was used.

## Completed checks

| Check                                                               | Result                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `bun run check`                                                     | Passed: lint, code rules, full type checking, and all tests  |
| `bun run --filter @mcp-cli/cli build`                               | Passed                                                       |
| `bun run --filter @mcp-cli/desktop native:build`                    | Passed                                                       |
| `codesign --verify --deep --strict 'apps/desktop/dist/MCP CLI.app'` | Passed: ad-hoc signature                                     |
| Built CLI methods JSON, schema, and dry-run JSON                    | Passed with a temporary configuration directory              |
| Built CLI with daemon mode selected while the daemon was stopped    | Confirmed fallback to a direct connection before the request |
| `git diff --check`                                                  | Passed                                                       |

## Test evidence

- `plugins/slack/test/web.test.ts`: routing for 41 workflow commands, request fields, help and schema, pagination, filters, payload reuse, URLs and timestamps, dates and DST, and partial batch failures.
- The same tests verify preservation of the existing 8 MCP tool names and inputs.
- The same tests verify that default authentication and `--xoxp` share duplicate-call keys.
- `plugins/slack/test/slack.test.ts`: authentication settings and compatibility with restricted MCP tool lists.
- Slack plugin test totals: 56 passed, 0 failed.
- `packages/mcp/test/web-api.test.ts`: 429 responses, real HTTP timeouts, prevention of write retries, and download host, redirect, size, and permission checks.
- `apps/cli/test/auth.test.ts`: temporary credential storage, environment-variable precedence, and explicit user-token selection.
- `apps/cli/test/daemon.test.ts`: direct/daemon result parity with mock HTTP servers, token-specific connection isolation, and preservation of errors after daemon sessions close. When the daemon is unavailable, the CLI switches to a direct connection before sending requests.
- Existing runtime tests verify duplicate-write protection and preservation of uncertain transmission states.

## Permission restrictions

- Slack restricts access through token scopes, membership, and workspace policies.
- Updating user status, searching messages, and marking messages as read require a user token.
- Permission errors preserve `error`, `needed`, and `provided` unchanged.
- Private channel names resolve only within the list visible to the token.
- Web API permissions and MCP tool exposure are separate.
- Permission verification against real accounts and MCP schema refresh were not performed.

## Implementation limits

- Channel-name resolution and message-context retrieval have a 10,000-item collection cap.
- If the cap prevents completion, the result is marked incomplete or a separate error is returned.
- `--include-muted` is rejected because no public API reliably exposes mute status.
- Unread results cover only the collected range. They are not presented as a total unread count.
- Markdown conversion handles headings, emphasis, strikethrough, links, quotes, code, and reserved characters.
- Full CommonMark layout and complete Block Kit semantic validation are not provided.
- Block Kit array sizes, main text lengths, and field/action counts are checked locally.
- The Slack server validates remaining API constraints.
- User-group join and leave operations cannot lock concurrent changes between reading and writing.
- Binary downloads use base64. Text downloads use UTF-8.
- The `.app` uses an ad-hoc signature. Developer ID signing and notarization were not performed.

## Code rules review

- sentinel: clean. Error branches use codes, types, and state.
- boundaries: clean. HTTP and authentication injection remain in the connection layer, and Slack policies remain in the plugin.
- boy scout: clean. Stored credentials are no longer read when an environment variable is present.
- file size: clean. Each new implementation file has fewer than 350 lines.
- parity: clean. Direct execution and the daemon use the same Web API connection implementation.
- comments: clean. New comments contain at most one sentence.

No real Slack messages were sent, edited, or deleted.
No real tokens were placed in fixtures, command arguments, or logs.
See the [README](README.md) for the status and call route of each of the 41 commands.
