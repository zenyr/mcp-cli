# Fast Semble

`fast-semble` exposes the official Semble MCP server through mcp-cli commands.
The mcp-cli daemon retains the stdio connection between calls, keeping Semble's
model and indexes in its process. Semble owns indexing, disk caching, and change
detection. This plugin contains no Python worker or independent result cache.

## Setup

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and make `uvx`
available on the CLI or desktop app's PATH. The plugin runs
`uvx --from 'semble[mcp]==0.7.2' semble`. Its version matches the checked-in tool
snapshot. The first connection downloads the Python environment; the first
search also downloads the embedding model from Hugging Face. Subsequent runs
reuse those downloads. No API key is required.

For workspace development:

```sh
bun install
bun bin/fast-semble.ts --help
# Keep this foreground daemon running in another terminal, or use the desktop app.
bun run cli daemon start
bun bin/fast-semble.ts search "authentication flow" .
```

Packaged builds include the plugin in their catalog. Install and activate it in
the desktop app, then register its `fast-semble` command in PATH. The upstream
`semble` command remains available separately.

## Commands

```sh
fast-semble search "authentication flow" /path/to/repo --top-k 3
fast-semble search "deployment" . --content docs
fast-semble search "parseConfig" --max-snippet-lines 0
fast-semble find-related src/auth.ts 42 /path/to/repo
fast-semble search --query "authentication" --repo /path/to/repo --json
fast-semble search --input '{"query":"authentication","repo":["/repo/a","/repo/b"]}'
fast-semble find-related --input '{"file_path":"src/auth.ts","line":42,"repo":"/repo/a"}'
```

The repository defaults to `.` for positional or flag input. JSON input follows
the upstream schema and requires `repo`. Use a JSON `repo` array for multiple
repositories. Use `--max-snippet-lines null` to request complete snippets.
Use `--` before positional values that start with a dash. Paths from search
results go directly into `find-related`; multi-repository paths include a prefix.

`--help`, `schema`, `methods`, and `skill` use local definitions without starting
Semble. Both search commands are read-only and allow repeated calls through the
host's repeat guard. Default output lists ranked `file:line-range` locations and
unchanged snippets, without repeating the query, field names, or scores.
Multiple-repository results retain the prefix-to-source map. Empty searches print
`No matches.`. Errors and unrecognized response shapes retain the host output.
`--json` preserves the full MCP result envelope, including scores and duplicate
text/structured payloads, for existing integrations and diagnostics.

## Process and cache lifetime

- Start the desktop app or `mcp-cli daemon start` to retain connections.
- Without a daemon, calls still work, but each starts and closes its own server.
- The current host closes idle connections after 60 seconds and permits 32
  connections. This plugin does not change those global limits.
- Connection keys include the caller's working directory and environment.
  Calls with the same connection key reuse one server. Different working
  directories or environments can create additional servers.
- Relative repository paths resolve against the caller's working directory.
  Use absolute paths in automation.
- Semble manages in-memory indexes and incremental disk cache updates. Its
  `SEMBLE_MCP_IDLE_TIMEOUT` controls unused in-memory index eviction in seconds.
  Its `SEMBLE_CACHE_LOCATION` controls disk cache location. Both pass through
  the host environment to the official process.
- `mcp-cli daemon status` shows pooled connections. `mcp-cli daemon reset`
  closes **all services'** pooled connections after active calls finish.
- Use upstream `semble clear index` for disk cache removal after stopping the
  relevant server. No plugin-specific cache status or clear command is added.

No latency improvement is guaranteed: repository size, cold downloads, model
loading, filesystem checks, and daemon availability affect each invocation.

## Updating Semble

Update the version in `src/index.ts`, regenerate with
`bun run generate fast-semble`, and verify search, related search, repeated
calls, and file-change detection against that exact version. Do not edit
`src/generated.ts` or `src/tools.json` manually.

Upstream references: [Semble](https://github.com/MinishLab/semble),
[server setup and cache lifetime](https://github.com/MinishLab/semble/blob/main/docs/installation.md).
