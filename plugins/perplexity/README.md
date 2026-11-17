# Perplexity

`pplx` exposes Perplexity's hosted MCP server (`https://api.perplexity.ai/mcp`)
through mcp-cli commands. The plugin runs no local server process.

## Setup

Choose one of these options:

1. Run `mcp-cli login pplx --browser` and approve the Perplexity OAuth page.
   The CLI registers an `mcp-cli` client, stores the tokens, and refreshes them.
   The desktop app's **브라우저 로그인** button runs the same login.
2. Create an API key in the [Perplexity API console](https://console.perplexity.ai).
   Run `mcp-cli login pplx` and paste the key.
3. Set `PERPLEXITY_API_KEY`.

Both logins write the same stored credential, so the most recent login wins.
`PERPLEXITY_API_KEY` wins over any stored credential.
`mcp-cli logout pplx` deletes the stored credential of either kind.
Set `PERPLEXITY_MCP_URL` to use another server URL.

## Commands

```sh
pplx search bun release notes --max-results 5 --search-type fast
pplx ask what changed in TypeScript 5.9 --search-recency-filter month
pplx reason compare SQLite WAL and rollback journal for concurrent readers
pplx research state of WebGPU support across browsers
pplx ask --messages '[{"role":"user","content":"hi"}]' --json
```

| Command    | Tool                  | Use                                       |
| ---------- | --------------------- | ----------------------------------------- |
| `search`   | `perplexity_search`   | Ranked URLs and snippets, no AI synthesis |
| `ask`      | `perplexity_ask`      | Quick cited answer, cheapest chat tool    |
| `reason`   | `perplexity_reason`   | Step-by-step analysis with citations      |
| `research` | `perplexity_research` | Deep multi-source report; takes minutes   |

Positional words become the `search` query or one user message for the chat
commands. Use `--` before text that starts with a dash. Positional text cannot
be combined with `--input`, `--input-file`, `--query`, or `--messages`.

Every call spends Perplexity API credits. `--help`, `schema`, `methods`, and
`skill` use the checked-in tool snapshot and make no network call.

## Regenerating the tool snapshot

The hosted server and `@perplexity-ai/mcp-server` 1.3.0 expose the same four tools.

```sh
bun run generate pplx
```
