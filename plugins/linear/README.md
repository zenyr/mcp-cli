# Linear plugin

Provides tool definitions and command mappings for the Linear MCP server.
Run these commands from the repository root.

```sh
bun run cli login linear
bun run generate linear
bun run cli linear --help
```

`LINEAR_MCP_TOKEN` takes precedence over stored tokens. Use `LINEAR_MCP_URL` to override the server URL.
See the [common usage guide](../../apps/cli/README.md) and [plugin development guide](../README.md).
