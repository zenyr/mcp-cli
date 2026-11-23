# mem plugin

The `mem` plugin exposes the read commands of the standalone [`mem` CLI](../../apps/mem/README.md) through `mcp-cli mem`.
It reads the same SQLite store and uses the Git project of the directory you run it from.
Only an `mcp-cli` started from this repository checkout discovers the plugin. Release builds do not include it.

```sh
mcp-cli mem memory start
mcp-cli mem memory recall --query "deploy target" --limit 5
mcp-cli mem record read --record global/0
```

- Tools: `start`, `recall`, and `read`. None of them calls a model.
- A call can create the SQLite store, scope rows, or the project id file, as the standalone CLI does. The tools are therefore not marked read-only.
- Save and summarize with the standalone `mem` CLI. Model calls can exceed the 30-second MCP call limit.
- `--scope global|project` selects scopes. The default is both, as in the standalone CLI.
- `--maxBytes` limits the mem JSON inside the tool result. `--json` prints the whole MCP result, which is larger.
- A mem failure is a tool error with exit code 1. The JSON `error.code` keeps the mem error code.
- Option-shaped values such as `--global` are rejected for `--query` and `--record`.

`"workspaceOnly": true` in `package.json` keeps the plugin out of release catalogs.
A catalog install would start the server in an isolated plugin directory with a private `HOME`, so it could not see the caller's project or store.

## Summary settings

Open the Mem plugin settings in the desktop app to set the summary model, OpenAI-compatible API base URL, and reasoning mode. Model and URL start empty. The shared plugin settings store persists these values, and the standalone CLI reads the same configuration.

You can also save them with the existing plugin configuration command:

```sh
printf '%s\n' '{"model":"your-model","baseUrl":"https://your-provider.example/v1","thinking":"default"}' | mcp-cli auth configure mem
```

CLI flags override environment variables, which override plugin settings, which override the legacy Mem configuration file. Set optional credentials through `MEM_API_KEY`. Unconfigured summary calls return `SUMMARY_NOT_CONFIGURED`; original records remain saved.
