# MCP CLI guide

Use `mcp-cli` to discover and run MCP server tools as static commands.
Run commands from the repository root. `mem` is a separate CLI with its [own guide](../mem/README.md).

## Standalone executable

Run `bun run --cwd apps/cli build` to create `apps/cli/dist/mcp-cli`.
Developers use this command to build the binary. Users of the resulting executable do not need Bun or the source repository.
The build creates the host executable and an adjacent `mcp-cli.plugins` directory.
The directory contains the default catalog and independent plugin packages; distribute both together.
The included catalog is an optional recommendation and is not registered automatically.
Load it in the desktop app or with `mcp-cli plugins catalog add builtin`, then install with
`mcp-cli plugins install builtin builtin.<service>` and activate with `mcp-cli plugins enable <service> --allow-local-code`.
New tool definitions are stored in the user cache.
The build targets the operating system and CPU running the build command.

## Getting started

To use the daemon, prepare connections in the desktop app or run `mcp-cli daemon start` in a separate terminal.
If the daemon is not running, the CLI connects directly.
Set `MCP_CLI_DAEMON=0` to require a direct connection.

The CLI creates the configuration directory on first use. The default location is `~/.config/mcp-cli`.
If you set `XDG_CONFIG_HOME` or `MCP_CLI_CONFIG`, it creates the parent directory of the corresponding configuration file.
It does not change existing configuration files.

`demo` is a hidden contract plugin. Set `MCP_CLI_INTERNAL_PLUGINS=1` to use it in the examples below.

```bash
bun install
export MCP_CLI_INTERNAL_PLUGINS=1
bun run generate demo
bun run cli --help
bun run cli demo --help
bun run cli demo message --help
bun run cli demo message echo --help
bun run cli demo message echo --text hello --count 2
bun run cli demo --json methods
bun run cli demo call demo-echo --input '{"text":"hello"}'
bun run check
```

`demo` is a local stdio MCP server in this repository. Use it to verify generation and execution without an external account.

## Progressive help

- `demo --help`: recommended commands (`Start here`), command groups, and discovery commands, each with a one-line description.
- `demo message --help`: subcommands in the group, each with a one-line description.
- `demo message echo --help`: tool arguments, types, required fields, and examples.
- `demo message echo --help=full`: the original server description and nested input/output JSON Schemas.
- `demo methods message --json`: only tool names and command paths in the group.
- `demo call --help`: MCP names and first-sentence summaries for all tools.
- `demo call demo-echo --help`: help for the same tool using its original MCP name.
- `demo skill`: service usage guidance from the plugin.

Root and group help show only subcommands and one-line summaries.
Default help for individual commands omits the original server description and limits argument descriptions to their first sentence, up to 160 characters.
`methods` shows tool names, paths, and the same summaries as help, up to 80 characters.
Use `--help=full` for complete schemas and original server descriptions. This command also works without a server connection.

## Input and output

```bash
bun run cli demo message echo --text '001' --uppercase
bun run cli demo message echo --text hello --no-uppercase
bun run cli demo message echo --text hello --parent.page-id abc
bun run cli demo message echo --input '{"text":"hello","labels":["a","b"]}'
bun run cli demo message echo --input-file ./input.json
printf '{"text":"hello"}' | bun run cli demo message echo --input -
bun run cli demo message echo --text=hello --count=2
```

String fields remain strings even when they look like numbers. `--page-id` maps to `page_id` in the schema.
Objects and arrays accept JSON values. Duplicate flags are rejected. Specify arrays as JSON arrays.
`--key=value` is equivalent to `--key value`. Use the `=` form when a value starts with `--`.
For nullable fields, `--x null` sets `null`. String fields keep `null` as a string.
`--input-file -` reads stdin like `--input -`. Unreadable files produce a usage error.
Do not mix JSON input, file input, and individual flags. Repeating `--input` produces a usage error.
The `--` end-of-options marker is not supported.
The default `call <tool-name>` path uses the tool name unchanged, so names containing `.` or `/` work without mappings.
Plugin-defined `path` segments must match `[A-Za-z0-9_-]+`.
If generated code is missing or outdated, the CLI exits with status 1 and asks you to run `mcp-cli generate <service>`.
Properties whose flag form conflicts with global flags (`--json`, `--help`, `--input`, `--input-file`, `--workspace`) can only be set through `--input`.
Help labels these properties `set via --input only`. The comparison replaces `_` with `-`.
Use `--input` for complex `$ref` or combined schemas. The entire input is validated against JSON Schema.
Schemas without `$schema`, or with a 2020-12 declaration, use 2020-12 rules. Draft-07 declarations and draft-07-only schemas use draft-07 validation.

Default output renders JSON data from MCP text blocks as compact YAML. Multiline strings use literal blocks (`|`, `|-`, or `|+`) to preserve line breaks. Plain text stays unchanged. `schema` also defaults to YAML. `--json` preserves the complete MCP result as JSON and works before the service name or among command flags.
When a tool returns `isError`, the CLI writes text results to stderr and exits with code `1`. stdout remains empty.
With `--json`, it writes even `isError` results to stdout as JSON. The exit code is `1`.
CLI usage errors (`UsageError`) exit with code `2`. Connection and execution errors exit with code `1`.
Unknown commands, invalid flags or values, mixed input sources, and input schema validation failures are usage errors.
The CLI connects to the server after input validation and plugin policies pass. It closes the connection after the call.

## Resources and prompts

```bash
bun run cli demo resources list
bun run cli demo resources templates
bun run cli demo resources read demo://readme
bun run cli demo prompts list
bun run cli demo prompts get summarize --text hello --style short
bun run cli demo prompts get summarize --input '{"text":"hello"}' --json
```

`resources` and `prompts` fetch lists and content from the server at runtime. They are not included in generated code.
Both commands connect to the server. `--help` and `help resources` do not connect.
Lists follow the server's `nextCursor` to completion and combine all pages.
If the server does not advertise the capability, the command fails with `MissingResourcesCapabilityError` or
`MissingPromptsCapabilityError`. It does not substitute an empty list. The exit code is `1`.

- `resources read <uri>`: prints text unchanged or a notice for binary content. Use `--json` to get base64.
- `prompts get <name>`: first reads the prompt's `arguments` from `prompts/list`.
  Supply arguments as `--<name> value` or an `--input` JSON object. All values are strings.
- Unknown prompts, unknown arguments, and missing required arguments are usage errors (exit code `2`).
- `--json` outputs structured JSON for `resources` and `prompts` results.

Plugin command paths cannot start with `resources` or `prompts`.

## Global commands

Run `bun link` once at the root to link `mcp-cli` and service commands into `~/.bun/bin`.
Service commands are equivalent to `mcp-cli <service>`. Example: `notion page get --help`.
Linked commands also prefer the daemon by default. If it is not running, they connect directly.
Set `MCP_CLI_DAEMON=0` to connect directly without checking for the daemon.
Help works without the daemon. `mem` is a separate CLI and does not use this setting.

Add `"bin": "<name>"` to the `"mcp-cli"` marker in a plugin's `package.json` to create a service command.
`bun run bins` rewrites the root `bin` field and `bin/<name>.ts` shims. `bun run lint` checks that they match.
Run `bun link` again after adding or removing a binary.

## Repeat protection

Tools without `readOnlyHint: true` or `idempotentHint: true` reject repeated calls with the same input.
Tools without annotations are also protected. Rejection happens before connecting to the server and exits with code `3`.

- The key combines the service, tool name, and SHA-256 of normalized input.
- A previous successful call or unknown outcome (timeout or forced termination) blocks repetition. A server error allows repetition.
- The default window is 5 minutes. Set `MCP_CLI_REPEAT_WINDOW` in seconds to change it, or use `0` to disable it.
- `--allow-repeat` skips the check once.
- Records are stored in `$XDG_STATE_HOME/mcp-cli/calls/<service>.json` (default: `~/.local/state/...`).

## Authentication

Plugins declare authentication through `auth`. The CLI supplies credentials to connections at runtime.

| `auth`                                    | Behavior                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `{ type: "oauth" }`                       | Adds the token obtained with `mcp-cli login <service>` to `Authorization` on each request       |
| `{ type: "apiKey", env: "FISH_API_KEY" }` | Sends the environment variable or key saved by `mcp-cli login` as `Authorization: Bearer <key>` |
| `{ type: "none" }` or omitted             | Supplies no credentials                                                                         |

```bash
mcp-cli login notion    # Log in through the browser and save the token.
mcp-cli logout notion   # Delete the saved token.
```

- `login` follows the MCP authentication sequence:
  protected resource metadata, authorization server metadata, dynamic client registration, and PKCE.
- The redirect URI is `http://127.0.0.1:<random port>/callback`. The CLI prints the authentication URL to stderr and opens the browser.
- If a browser cannot open, run `mcp-cli login <service> --no-browser`.
  The CLI only prints the URL. Open it on another device and approve access.
  The redirected `127.0.0.1` address does not need to load. Paste the full address into the terminal to finish login.
- The CLI does not automatically open a browser with `MCP_CLI_NO_BROWSER=1`, in SSH sessions, or on Linux without `DISPLAY`.
- `login` validates `state` and fails if no response arrives within 5 minutes.
- Setting OAuth `clientId` skips dynamic registration. You can also set `scopes`, `clientName`, and `redirectPort`.
- Setting API key `header` sends only the key without a scheme. Use `scheme` to set a prefix.
- For API key services, `mcp-cli login <service>` reads hidden input or piped stdin and saves the key.
  The environment variable takes precedence over the saved key. `mcp-cli logout <service>` deletes the saved key.
  Catalog-installed and linked plugins ignore API key environment variables. Use `mcp-cli login` for them.
- `apiKey.alternates` declares other keys for the same service. Select one with `--<flag>` at runtime
  and use the same flag for login and logout. Example: Slack's `--xoxb` (`SLACK_MCP_BOT_TOKEN`).
  stdio connections receive keys through environment variables with the same names.
- Tokens are stored in `$XDG_CONFIG_HOME/mcp-cli/credentials/<service>.json`. Without `XDG_CONFIG_HOME`, the CLI uses `~/.config`.
  Directory permissions are `0700` and file permissions are `0600`. Writes use a temporary file followed by rename.
- Tokens refresh starting 60 seconds before expiry, or after a server returns 401.
  Refresh runs inside a kernel `flock` on `<service>.lock`, so concurrent processes make only one refresh request.
  The kernel releases the lock immediately if its owner terminates unexpectedly. The lock file remains in place.
  Platforms without `flock` use a heartbeat lock file and reclaim locks that have not refreshed for 15 seconds.
- If credentials are missing or the refresh token is rejected, the CLI asks you to run `mcp-cli login <service>` and exits with status 1.
- Tokens issued for another server URL are never sent. Log in again after changing the URL.
- If a connection provides `authorize` directly, the CLI does not use saved tokens.
  Notion gives `NOTION_MCP_TOKEN` precedence when set.
- `logout` deletes local files only. It does not request server-side token revocation.

Only `packages/mcp` uses the MCP SDK's OAuth functions. `packages/auth` provides storage, and `packages/core` provides contract types.

## Connection daemon

```sh
bun run cli daemon start
# Run in another terminal.
bun run cli demo message echo --text hello
bun run cli daemon status
bun run cli daemon reset
bun run cli daemon stop
```

The CLI uses daemon connections by default, with the same output and exit codes as direct connections.
Set `MCP_CLI_DAEMON=0` to connect directly for a single command.
If the daemon is not running, the CLI falls back to a direct connection before sending a tool request.
Errors after sending a tool request do not trigger a retry through a direct connection.
The daemon maintains up to 32 connections and closes idle connections after 60 seconds.
Reset and shutdown wait for active requests. Failed tool calls are not retried.
The daemon uses authenticated local IPC. Set `MCP_CLI_DAEMON_DIR` to an absolute path to customize its directory.
After an abnormal daemon exit, the next `daemon start` recovers stale state.
Run `mcp-cli daemon recover` to recover it without starting the daemon.
Ownership, token, and socket files are removed only when the recorded PID is absent and the socket cannot be reached.
If the PID is alive, the socket responds, or ownership cannot be verified, recovery preserves the state and stops.
A lock protects concurrent recovery and startup. Stale locks are not deleted automatically.
See the [desktop guide](../desktop/README.md) for the tray app.

## Current support

Generation, discovery, input validation, invocation, and shutdown are integration-tested with the local `demo`.
Both stdio and Streamable HTTP connections are available, but live connection tests cover only stdio.
Notion, Linear, Slack, and Fish Audio include definitions generated from real servers and noun–verb command mappings.
Notion, Linear, and Fish Audio use OAuth tokens saved by `mcp-cli login <service>`.
See each plugin's guide for its authentication requirements.

Markdown specification checks, edit protection, and widgets from the previous Notion CLI have not been migrated.
SSE connections and CLI code generation for resources and prompts are not supported.
Resources and prompts are fetched from the server at runtime.

`NOTION_MCP_TOKEN` and `LINEAR_MCP_TOKEN` take precedence over saved tokens.
Use `*_MCP_URL` to override server URLs.
HTTP connections obtain headers from `authorize` on each request.
If the server returns 401, the connection calls `authorize({ refresh: true })` once and retries only once.

```sh
bun run cli login notion
bun run generate notion
bun run cli notion page get --help
```

## Related documentation

- [Plugin authoring and static generation](../../plugins/README.md)
- [Development environment and package layout](../../docs/development.md)

## Multiple workspaces

Slack, Notion, and Linear share one command catalog per plugin and can store multiple workspace connections.
Existing credentials and settings remain available as the `default` workspace, without moving secret files.

```bash
mcp-cli workspaces add slack company
mcp-cli login slack -w company
slack -w company auth check
mcp-cli workspaces default slack company
mcp-cli workspaces rename slack company work
mcp-cli workspaces list slack
notion --workspace personal search --query "travel"
```

Use `-w NAME`, `--workspace NAME`, or `--workspace=NAME` to select a workspace for a command, login, logout, authentication settings, or generation.
The host accepts a stable workspace ID in place of its name.
A name is a local alias for a separately authenticated connection; OAuth still asks you to select or approve the remote workspace.
Create an alias before logging in to it.
Without a selector, the configured default is used; an ambiguous selection fails before dispatch.
Adding another workspace does not change the default.
Renaming an alias retains its credentials, settings, and storage identity.
Logout deletes only the selected credential in the selected workspace.

Existing token environment variables apply only to the original `default` workspace, even after it is renamed.
Additional workspaces use their own stored credentials and settings.
The host isolates daemon sessions, workflow caches, duplicate-call guards, and authentication locks by workspace.
Nested workflow commands inherit the selected workspace unless they explicitly choose another one.
Help, methods, and schema remain available without authentication or a workspace connection.

The desktop app lists each workspace's authentication state and supports adding, renaming, and choosing the default workspace.
Its daemon and authentication IPC responses remain single-line JSON.

## Session tool discovery (opt-in)

MCP package descriptors can select account-specific tool discovery without running `generate`:

```json
{
  "schemaVersion": 1,
  "implementation": {
    "type": "mcp",
    "server": { "type": "http", "url": "https://example.com/mcp" },
    "auth": { "type": "oauth" },
    "discovery": { "tools": "session" }
  }
}
```

This fragment belongs in a complete `plugin.json` with the usual package metadata and permissions.
Descriptors that omit `discovery` keep static behavior, including generated cache overrides.
Existing hosts reject the new field explicitly; updated hosts accept existing descriptors.
There is no new engine negotiation or `minHostVersion` field.
The repository currently has no host release identifier beyond its private package version;
identify this feature by its introducing Git commit until a formal release is published.

For session discovery, service root help and `skill` remain offline and identify their bundled
bootstrap catalog. The package's `manifest.json` supplies that catalog even if a generated cache
exists. It is documentation, not a claim about the selected account's current permissions.
`methods`, `schema`, group/tool help, and tool execution require live discovery.
Discovery failure never falls back to bootstrap tools for dispatch, including tools marked read-only.
The CLI selects the workspace and credential, opens one session, discovers tools, then parses
schema-dependent flags and dispatches through that same session.

The daemon caches one successful catalog per actual MCP connection and shares concurrent discovery.
All pages must succeed before publication; empty lists replace the previous catalog completely.
`notifications/tools/list_changed` invalidates the catalog, including discoveries already in flight.
New connections rediscover tools; idle connections still expire under the existing daemon policy.
A continuously used connection can last longer than the idle timeout. Without server notifications,
permission changes become visible on the next connection. The server must enforce authorization.
No account-specific catalog is persisted by automatic discovery, and failed calls are not replayed.
Manual `generate` remains an explicit fresh discovery and persistence operation.

During development, use `MCP_CLI_DAEMON=0` for a direct connection, or set a separate absolute
`MCP_CLI_DAEMON_DIR` for both the updated daemon and its CLI clients.
Do not use an old daemon to test the new policy.
Normal upgrades retain the plugin credential namespace when source and plugin identity stay the same;
linking a copy from another source gives it a separate identity and may require a separate login.
