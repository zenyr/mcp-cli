# mcp-cli

A CLI for discovering and running MCP server tools as static commands.
It generates code from server tool definitions. Service plugins provide command paths and usage guidance.

## Features

- Explore only what you need, with help at the service, command group, and individual tool levels.
- Read help and tool lists without connecting to a server. Connections and input validation happen when you run tools.
- Call tools by their original server names or use command paths defined by plugins.
- Use stdio and Streamable HTTP connections with OAuth or API key authentication.
- Includes Notion, Linear, Slack, Fish Audio, Suno, Perplexity (`pplx`), Claudia, and Fast Semble plugins.
- Includes hidden `demo` and `demo-auth` plugins that need no external account. Set `MCP_CLI_INTERNAL_PLUGINS=1` to use them.

## Tools in this repository

The main tool is `mcp-cli`. Plugins extend it with service-specific commands.
The desktop tray app manages MCP CLI connections and authentication.
It includes the CLI host and independently installable default plugin packages, so users do not need separate development tools.

`mem` is a separate memory management CLI developed in this repository.
It stores original text and summary trees in local SQLite and supports project-scoped memory search and retrieval.
It has its own configuration and storage and is neither an `mcp-cli` subcommand nor an MCP plugin.

## Documentation

- [MCP CLI guide](apps/cli/README.md): installation, command discovery, input and output, authentication, and the connection daemon
- [Plugin guide](plugins/README.md): available plugins, authoring, and static generation
- [Desktop app guide](apps/desktop/README.md): running the app, native builds, and daemon management
- [mem guide](apps/mem/README.md): storing, searching, summarizing, and recovering memory
- [Development guide](docs/development.md): package layout, worktrees, and quality checks

## Security

See the [security policy](SECURITY.md) for supported revisions and private
vulnerability reporting.

## License

Original project work is licensed under the [MIT License](LICENSE).
Third-party materials retain their respective licenses.
