# mem

`mem` is an independent CLI developed in this repository. It is not an `mcp-cli` subcommand.
The workspace-only [`mem` plugin](../../plugins/mem/README.md) exposes `start`, `recall`, and `read` through `mcp-cli mem`.
It uses its own configuration and SQLite storage without connecting to an MCP server.
Run commands from the repository root. See the [development guide](../../docs/development.md) for installation and environment setup.

`mem` stores original text and summary trees in local SQLite. The model and API base URL are empty by default. Configure them in the Mem plugin settings in the desktop app before summarizing.

```sh
bun run mem start
bun run mem save 'Project decisions'
bun run mem save --stdin --kind talk < transcript.txt
bun run mem save --file notes.txt --receipt 550e8400-e29b-41d4-a716-446655440000
bun run mem recall 'decision' --max-bytes 1024
bun run mem read '<scopeId>/0' --cursor 0
bun run mem zoom '<scopeId>/0' --count 4 --generation '<generation>'
bun run mem pin '<scopeId>/0' --key deploy-target --from 0 --to 20 --expected-revision 0 --receipt 550e8400-e29b-41d4-a716-446655440000
bun run mem unpin deploy-target --expected-revision 1 --receipt 550e8400-e29b-41d4-a716-446655440001
bun run mem pins --key deploy-target
bun run mem summarize
bun run mem status
bun run mem config
```

To run the CLI directly, pass the same arguments after `bun apps/mem/src/main.ts`.

- `save` stores text in the current Git project. Outside a Git project, specify `--global`.
- `start`, `recall`, `status`, and `summarize` select the global scope and current project by default.
- `--global` and `--project` are mutually exclusive.
- `start` does not call the model. If summaries are incomplete, it recommends `mem summarize`.
- Original text remains stored even if summarization fails after saving. Use the error's `recordId`, `receipt`, and `recoveryCommand`.
- The same receipt and original text return the same record. Different text with the same receipt produces a conflict error.
- `recall` searches with NFC normalization and lowercase conversion. Results are ordered newest first.
- Use a `recall` cursor with the same query and scope. Newly saved records do not enter existing pagination.
- A `read` cursor is a Unicode scalar position in the original text. Pass the response cursor to read the next page.
- `--max-bytes` includes the entire JSON response and its final newline. The default is 8192 bytes.
- Successes and errors each print one JSON object to stdout. Help uses plain text.
- Exit codes are 0 for success, 1 for execution failure, and 2 for option errors.

Override connection settings with `--model` and `--base-url`. The connection uses an HTTP server that provides `/chat/completions`. If set, `MEM_API_KEY` is sent in the Authorization header.

## Configuration and storage

The desktop plugin stores model, base URL, and thinking settings in the shared plugin settings store. These override the legacy file settings.

The legacy configuration file is `$XDG_CONFIG_HOME/mem/config.json`. If the variable is missing or relative, the base directory is `~/.config`.
Original text and summaries are stored in `$XDG_DATA_HOME/mem/memory.sqlite`. If the variable is missing or relative, the base directory is `~/.local/share`.
SQLite uses WAL and FULL synchronization. Project and global records share one file, separated by scope.

```json
{
  "baseUrl": "",
  "model": "",
  "nodeBytes": 512,
  "contextBytes": 8192,
  "inputBytes": 131072,
  "timeoutMs": 60000,
  "maxOutputTokens": 4096
}
```

`MEM_BASE_URL`, `MEM_MODEL`, and `MEM_NODE_BYTES` override file settings. `mem config` shows the effective configuration.
`MEM_MAX_OUTPUT_TOKENS` changes the model's output limit. Reasoning tokens may also consume this limit.
`MEM_THINKING=enabled` or `disabled` explicitly sets reasoning mode for supported providers. An unset value or `default` uses the provider default.
This option is provider-specific. Unsupported servers may reject the request.
Changing the output limit or timeout preserves the generation, allowing interrupted work to resume.
API keys are accepted only through `MEM_API_KEY`. The CLI excludes API keys from configuration output.
This version does not provide a summarization adapter that runs arbitrary commands.

The project ID is stored in `mem-project-id` in the Git common directory.
The `mem.project-id` Git setting takes precedence when present.
Linked worktrees share project memory.
Separate clones are not linked automatically.

## Summarization and recovery

`save` records the original text first. The summarizer compresses long messages and merges adjacent sibling summaries into parents.
Short leaves retain the original text and its source. Short parents also concatenate both children's text without modification.
Only input exceeding the target size uses the LLM.

The summarizer is instructed to preserve user decisions, corrections, prohibitions, and failure causes.
A leaf's model input contains only its own message. A parent's input contains only its two children.
Retries send the original input and compression instructions. They exclude previous model responses and earlier records outside the node's range.

When the input's referent is unclear, the summarizer is instructed to preserve that uncertainty.
This policy does not guarantee freedom from hallucinations. Observations on synthetic records are documented in the [current policy verification](eval/RANGE_ONLY.md).

The default node target is 512 UTF-8 bytes. The summarizer accepts responses at most 1.25 times the target and smaller than the input.
There are at most three compression attempts. Retry targets decrease to 75% and 50% of the base target.
The minimum target is 1 byte.
The original source is preserved, and previous responses are not sent again.
If the third response remains oversized, or the input exceeds `inputBytes`, the node becomes an excerpt.
The excerpt holds a byte-bounded prefix of the original text and a marker such as `[unsummarized; mem read <scopeId/index>]`.
Parent excerpts hold a prefix of each child and point to `mem zoom` with the generation. Excerpts keep `start` usable.
If a parent summary is missing, `start` and `zoom` build the same excerpt without storing it. A later `summarize` can still store a real summary.
Other summarizer failures do not stop the remaining nodes. `summarize` reports the first such failure after it builds every other node.
An unreachable summarizer stops further model calls for that run.
The current generation v3 uses the `range-only-v1` policy. Rebuild trees from existing caches with `mem summarize`.
Changing summarization settings creates a tree in a new generation. Completed nodes in earlier generations remain unchanged.

`start` outputs summaries covering every original text range. The selector merges sibling summaries until the entire response fits the budget.
If the budget cannot be met, the CLI returns `MEMORY_OVERFLOW`. It does not silently omit older ranges.
`contextBytes` is accepted for backward compatibility. The summarizer does not use it in model input or the generation hash.

The maximum size of one original record is 1 MiB. Model requests are checked against `inputBytes`, including JSON and instructions.
This byte check does not guarantee compliance with model-specific token limits.
`usage` aggregates usage from successfully parsed summary responses. Charges for failed or truncated responses are unknown.
`unmeasuredCalls` counts calls whose responses lacked valid token usage totals.

Startup injection requires session startup instructions or a host hook to insert `mem start` stdout into context.
This CLI does not modify host instructions or hooks automatically.

## Tree navigation and verbatim pins

`zoom` uses the generation and address returned by `start`. `--count` must be a power of two.
The message index must be a multiple of count. When count exceeds 1, the command returns two child summaries.
When count is 1, it returns the first page of original text. Use the same generation and returned cursor for subsequent pages.
Reads do not call the model or create incomplete nodes. Nodes from older generations remain readable.

`pin` includes the selected original text range verbatim in the startup packet. `--from` and `--to` define a Unicode scalar range `[from, to)`.
For a new key, use `--expected-revision 0`. To replace an existing key, use the revision returned by `pins`.
The same receipt and request return the previous operation's result. If later changes exist, query `pins` again for the current state.
`pins` returns revisions, original text addresses, and ranges. It does not repeat large text bodies. Retrieve those with `read`.
`unpin` removes a pin. It does not revoke instructions in the original text or mark a task complete.

Pin changes default to the current project. Specify `--global` for global records.
Each scope allows up to 8 active pins. The pin block across selected scopes is limited to 2,048 bytes of JSON.
All active pins are mandatory. Exceeding the pin limit returns `PIN_OVERFLOW`. Exceeding the entire packet limit returns `MEMORY_OVERFLOW`.
The CLI does not silently omit pins. Pins whose source text is missing are marked `SOURCE_UNAVAILABLE` and can be removed.

A pin's kind is the source label supplied by the caller when saving. It does not indicate authenticated user approval or fact verification.
Changes to summarization policy do not affect verbatim pins. If existing memory returns `SUMMARY_PENDING`, build a new tree with `mem summarize`.

The current version does not implement automatic session hooks, strict model token context limits, semantic summary quality guarantees, or the full V2 feature set.

The [verification record](VERIFICATION.md) distinguishes automated tests from live OpenCode GO summarization results.
The [historical 32-record evaluation](eval/RESULTS.md) records generation v2 runs with context, isolated runs, and failures.
The [current range-only evaluation](eval/RANGE_ONLY.md) records input boundaries and a rerun using the same fixture.
