# Slack CLI

Use the official Slack MCP and Slack Web API from one CLI.
Existing singular commands call MCP.
New plural commands call `https://slack.com/api/<method>`.
Web API and MCP routes do not fall back to each other on failure.

## Authentication and execution

```sh
mcp-cli login slack
mcp-cli login slack --xoxb
slack auth check
slack auth whoami --xoxb
slack channels list --json
MCP_CLI_DAEMON=0 slack channels list --json
```

- Default authentication and `--xoxp` use the same user credentials and connection.
- The app displays `xoxp` and `xoxb` without a duplicate default entry.
- `--xoxb` selects separately stored bot credentials.
- Using both options together produces a usage error.
- `SLACK_MCP_TOKEN` and `SLACK_MCP_BOT_TOKEN` take precedence over their respective stored credentials.
- Do not pass tokens as command arguments.
- Execution prefers the daemon by default. If unavailable, the CLI switches to a direct connection before sending the request.
- `MCP_CLI_DAEMON=0` uses a direct connection for that command. `1` or an empty value uses the daemon.
- The daemon isolates connections by credentials and connection settings.
- Write requests do not retry automatically. Uncertain outcomes preserve duplicate-protection state.
- Read requests retry once only for `429` responses with `Retry-After: 0`.
- `schema <command path>` and `--help=full` print the current input schema.
- `methods --json` lists both MCP tools and Web API commands.

## New commands and fixed call routes

Each command supports `--help` and `--json`.
`web.test.ts` checks mock HTTP routing for the following 41 commands.
`Implemented/passed` does not indicate verification against live Slack calls.

| Command                 | Web API                                                        | Implementation/tests | Remaining differences and limits               |
| ----------------------- | -------------------------------------------------------------- | -------------------- | ---------------------------------------------- |
| channels list           | conversations.list                                             | Implemented/passed   | Filtering and sorting within collected results |
| channels me             | users.conversations                                            | Implemented/passed   | Token visibility applies                       |
| channels info           | conversations.info                                             | Implemented/passed   | Name resolution capped at 10,000 items         |
| channels search         | conversations.list                                             | Implemented/passed   | Filters a list, not server-side search         |
| channels join           | conversations.join                                             | Implemented/passed   | Name resolution capped at 10,000 items         |
| channels leave          | conversations.leave                                            | Implemented/passed   | Name resolution capped at 10,000 items         |
| users list              | users.list                                                     | Implemented/passed   | Retrieval limit applies                        |
| users get               | users.info                                                     | Implemented/passed   | Failures preserved per user                    |
| users search            | users.info or users.list                                       | Implemented/passed   | List searches use the retrieval limit          |
| users status get        | users.profile.get                                              | Implemented/passed   | Token visibility applies                       |
| users status set        | users.profile.set                                              | Implemented/passed   | Requires a user token                          |
| users status clear      | users.profile.set                                              | Implemented/passed   | Requires a user token                          |
| messages search         | search.messages                                                | Implemented/passed   | User token and page-number pagination          |
| messages fetch          | conversations.history or conversations.replies                 | Implemented/passed   | Returns only an exact ts match                 |
| messages history        | conversations.history                                          | Implemented/passed   | Preserves cursors and ranges                   |
| messages context        | conversations.history or conversations.replies                 | Implemented/passed   | 10,000-item cap; reports missing ranges        |
| messages post           | chat.postMessage                                               | Implemented/passed   | Posting policies apply                         |
| messages post-ephemeral | chat.postEphemeral                                             | Implemented/passed   | Identifies messages as nonpersistent           |
| messages delete         | chat.delete                                                    | Implemented/passed   | No automatic retries                           |
| messages update         | chat.update                                                    | Implemented/passed   | Distinguishes omitted and empty values         |
| messages reply          | chat.postMessage                                               | Implemented/passed   | Posting policies apply                         |
| messages replies        | conversations.replies                                          | Implemented/passed   | Preserves cursors and ranges                   |
| messages unreads        | users.conversations, conversations.info, conversations.history | Implemented/passed   | No mute filter; see below                      |
| messages mark           | conversations.mark                                             | Implemented/passed   | Requires a user token                          |
| messages pin            | pins.add                                                       | Implemented/passed   | No automatic retries                           |
| messages unpin          | pins.remove                                                    | Implemented/passed   | No automatic retries                           |
| messages pins           | pins.list                                                      | Implemented/passed   | No server cursor; local limit                  |
| reactions add           | reactions.add                                                  | Implemented/passed   | Removes surrounding emoji colons               |
| reactions remove        | reactions.remove                                               | Implemented/passed   | Removes surrounding emoji colons               |
| reactions list          | reactions.get                                                  | Implemented/passed   | Supports message URLs                          |
| attachment get          | files.info, authenticated HTTPS download                       | Implemented/passed   | Disabled by default; 5 MiB maximum             |
| usergroups list         | usergroups.list                                                | Implemented/passed   | No server cursor; local limit                  |
| usergroups get          | usergroups.list, usergroups.users.list                         | Implemented/passed   | ID or handle                                   |
| usergroups create       | usergroups.create                                              | Implemented/passed   | name required                                  |
| usergroups update       | usergroups.update                                              | Implemented/passed   | Sends changed fields only                      |
| usergroups users update | usergroups.users.update                                        | Implemented/passed   | Replaces all members                           |
| usergroups me list      | auth.test, usergroups.list, usergroups.users.list              | Implemented/passed   | Retrieves membership per group                 |
| usergroups me join      | auth.test, usergroups.users.list, usergroups.users.update      | Implemented/passed   | Concurrent modification risk                   |
| usergroups me leave     | auth.test, usergroups.users.list, usergroups.users.update      | Implemented/passed   | Rejects removal of the last member             |
| views publish           | views.publish                                                  | Implemented/passed   | Home views only                                |
| views clear             | views.publish                                                  | Implemented/passed   | Publishes empty home blocks                    |

## Lists, search, and time

```sh
slack channels list --type private --query release --query-targets name,topic --sort popularity --limit 200
slack channels search release --limit 1000
slack users get U0123456789 U9876543210
slack messages history C0123456789 --limit 50 --cursor '<cursor>'
slack messages search deploy --after 1w --timezone Asia/Seoul --page 2
slack users status set :house: 'Working from home' --expiration today --timezone Asia/Seoul
```

- List results include `items`, `next_cursor`, and `partial`.
- APIs without cursors return `next_cursor: null`.
- `--limit` defaults to 100. The retrieval limit is not the total result count.
- Channel popularity sorting uses `num_members` from collected channels.
- Channel-name resolution scans up to 10,000 items. Reaching the cap and finding no match produce different errors.
- `users get` removes duplicate IDs. Partial failures are preserved per item.
- Message search uses `--limit` up to 100 and `--page`. It does not accept `--cursor`.
- `messages search` and `call web.search.messages` send search arguments with form encoding.
- `--im <conversation>` passes that DM conversation as an `in:` search condition.
- Search condition values are quoted and escaped. The user's base query retains Slack search syntax.
- `--after`, `--before`, and `--on` support `YYYY-MM-DD`, `1d`, `1w`, and `30d`.
- Relative dates use calendar dates in the specified IANA time zone.
- `today` means the next midnight in that time zone, accounting for DST transitions.
- Omitting status expiration sets no expiration.
- `messages unreads` collects messages after `last_read` in joined channels.
- `--mentions-only` checks the actual body for `<@current-user-ID>`.
- The Web API does not reliably expose user mute settings. `--include-muted` produces a usage error.
- Unread results may include muted channels. Output states this limitation.
- Context retrieval reports `partial` and missing ranges when it reaches the cap.

## Reviewing and sending messages

```sh
slack messages post C0123456789 '**Deployment complete**' --blocks --dry-run --payload-out request.json
slack messages post --payload @request.json
slack messages update 'https://workspace.slack.com/archives/C0123456789/p1700000000123456' 'Updated content'
slack messages reply 'https://workspace.slack.com/archives/C0123456789/p1700000000123456' 'Confirmed'
```

- `--blocks <JSON>` accepts a Block Kit array.
- `--blocks` and `--blocks=true` convert Markdown text to Block Kit.
- Conversion handles headings, bold text, links, and reserved HTML characters. It is not a complete CommonMark renderer.
- `--blocks -` reads an array from stdin.
- `--attachments <JSON>` accepts an attachment array.
- `--payload JSON|-|@file` accepts a request object. Unsupported fields are rejected.
- Positional arguments or options that duplicate payload fields are rejected.
- Stdin can be used only once. Text and blocks cannot both come from stdin.
- When only blocks are provided, text elements generate accessible fallback text.
- Blocks that cannot produce fallback text require explicit text.
- `--dry-run` performs no writes. Resolving channel names may require read requests.
- `--payload-out` creates new files only. It never overwrites files.
- Reuse saved payload files with `messages post --payload @file` or `messages update --payload @file`.
- Updates preserve omitted fields. Empty strings and arrays clear existing content.
- Timestamps remain strings. URL parsing distinguishes a thread's parent from the target message.
- `SLACK_MCP_POST_CHANNEL_ALLOWLIST` and `SLACK_MCP_POST_CHANNEL_DENYLIST` accept comma-separated channel IDs.
- When both policies exist, post and reply require inclusion in the allowlist and absence from the denylist.

## Attachments and batches

```sh
SLACK_MCP_ATTACHMENT_TOOL=true slack attachment get F0123456789 --content
SLACK_MCP_ATTACHMENT_TOOL=true slack attachment get F0123456789 --save
slack batch 'channels list --limit 10' 'users list --limit 10' --stop-on-error=false
```

- `attachment get` is disabled by default.
- Enable it with `SLACK_MCP_ATTACHMENT_TOOL=true|1|yes` or `SLACK_MCP_ENABLED_TOOLS=attachment_get_data`.
- The default operation retrieves metadata. `--content` and `--save` are mutually exclusive.
- Downloads allow only HTTPS URLs on `files.slack.com` and `slack-files.com`.
- All redirects are rejected. Both Content-Length and actual received bytes are limited.
- Text output uses UTF-8, and binary output uses base64. Output includes MIME type and encoding.
- Storage directories use mode 0700, and randomly named files use 0600. Original filenames are not used as paths.
- File bodies are untrusted data.
- Batches run up to 50 commands sequentially without invoking a shell.
- Nested batches and invalid quoting or escaping are rejected.
- `--stop-on-error` and `--fail-on-error` default to true.
- Each item preserves its result, exit code, and elapsed time. Authentication is inherited or selected per item.
- Do not retry an entire batch when some items have succeeded.

## Existing MCP compatibility

| Command          | Exact MCP tool           |
| ---------------- | ------------------------ |
| channel read     | slack_read_channel       |
| thread read      | slack_read_thread        |
| message send     | slack_send_message       |
| message schedule | slack_schedule_message   |
| message draft    | slack_send_message_draft |
| reaction add     | slack_add_reaction       |
| reaction list    | slack_get_reactions      |
| file read        | slack_read_file          |

`call <exact-tool-name>` calls MCP tools from the current generated schema.
`call web.<method>` calls statically defined Web API methods.
Singular and plural commands have no automatic aliases or fallback routes.
MCP connections use `SLACK_MCP_URL` or the default `https://mcp.slack.com/mcp`.
MCP file-read format and size limits follow the current server tool schema.
Web API attachment-get output formats and its 5 MiB cap are separate.
The scheduled-send schemas for `post_at`, `thread_ts`, and `reply_broadcast` are unchanged.
Draft-tool inputs and results are also unchanged.

## Permissions and validation scope

- The Web API applies user and bot token scopes and channel membership.
- Status changes, message search, and marking messages as read require a user token.
- Permission errors preserve `error`, `needed`, and `provided`.
- MCP access is separate from the Web API's `search:read` permission.
- MCP schema refresh uses only tools exposed by the server for the current credentials.
- Tests do not send, edit, or delete real Slack messages.
- Tests use mock HTTP, mock MCP calls, and temporary credential storage.
- See the [validation record](VALIDATION.md) for platform builds and check results.

[Official Web API methods](https://docs.slack.dev/reference/methods/),
[Slack search syntax](https://slack.com/help/articles/202528808-Search-in-Slack),
[Common usage guide](../../apps/cli/README.md)
