# mem plugin

The `mem` plugin exposes the read commands of the standalone [`mem` CLI](../../apps/mem/README.md) through `mcp-cli mem`.
It reads the same SQLite store and uses the Git project of the directory you run it from.
The desktop app includes Mem in its built-in plugin catalog. Install and enable it from Plugins, then open its settings on the Settings tab.

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

The packaged module launches its bundled server through the CLI runtime. It retains the caller's directory and environment, so installed and source versions read the same memory database and plugin settings.

## Summary settings

Open the Mem plugin settings in the desktop app. Enter the OpenAI-compatible API base URL, optional API key, and optional JSON headers, then choose **Load models** or type a model ID directly. Loading models uses the current form without saving it. Save to apply the connection, model, and reasoning mode.

Model and URL start empty. The shared plugin settings store persists the connection settings, and the private credential store holds the API key. The standalone CLI reads both stores. Leave the API key input empty to retain a saved key; use **Delete saved API key** to remove it.

You can also save them with the existing plugin configuration command:

```sh
printf '%s\n' '{"model":"your-model","baseUrl":"https://your-provider.example/v1","thinking":"default"}' | mcp-cli auth configure mem
```

CLI flags override environment variables, which override plugin settings, which override the legacy Mem configuration file. `MEM_API_KEY` overrides the saved API key. Custom headers must be a JSON object with string values and apply to both `GET /models` and summary requests. An API key takes precedence over a custom Authorization header. Unconfigured summary calls return `SUMMARY_NOT_CONFIGURED`; original records remain saved.
