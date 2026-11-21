# mem plugin

The `mem` plugin exposes the read commands of the standalone [`mem` CLI](../../apps/mem/README.md) through `mcp-cli mem`.
It reads the same SQLite store and uses the caller's Git project, so it runs only from this repository checkout.

```sh
mcp-cli mem memory start
mcp-cli mem memory recall --query "deploy target" --limit 5
mcp-cli mem record read --record global/0
```

- Tools: `start`, `recall`, and `read`. None of them calls a model.
- Save and summarize with the standalone `mem` CLI. Model calls can exceed the 30-second MCP call limit.
- `--scope global|project` selects scopes. The default is both, as in the standalone CLI.
- `--maxBytes` limits the mem JSON inside the tool result. `--json` prints the whole MCP result, which is larger.
- A mem failure is a tool error with exit code 1. The JSON `error.code` keeps the mem error code.
- Option-shaped values such as `--global` are rejected for `--query` and `--record`.

`"workspaceOnly": true` in `package.json` keeps the plugin out of release catalogs.
A catalog install would start the server in an isolated plugin directory with a private `HOME`, so it could not see the caller's project or store.
