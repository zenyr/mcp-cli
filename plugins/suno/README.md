# Suno plugin

Connects to [Suno's official MCP server](https://suno.com/mcp) using OAuth.
Run these commands from the repository root:

```sh
bun run cli login suno
bun run generate suno
bun run cli suno --help
```

Sign in to Suno and approve access in the browser when prompted.
No API key is required. Generation uses your Suno account's credits, and songs
are saved to your Suno library.

## Commands

```sh
suno account usage
suno library list --limit 10
suno library search --query jazz
suno audio create --description "A mellow jazz instrumental" --instrumental
suno audio wait --id <clip-id>
suno audio get --id <clip-id>
suno audio download --id <clip-id>
suno voice list
suno visuals models
```

Use `bun run cli suno` in place of `suno` when running from source without the
service command on PATH. All 60 tools in the captured server catalog have mapped
commands; `suno methods` lists them. Original tool names remain available through
`suno call <tool-name>`. Use `--help=full` for the server's full instructions and
`--input` or `--input-file` for nested objects.

Simple generation takes `--description`; custom generation takes `--lyrics` and
`--style`. Do not combine `--description` with `--style`. Omit `--model` to use
your plan's default. Use `--idempotency-key` when retrying a creation request with
the same inputs. Only enable `--max-mode` when you intend to spend extra credits.

Downloads return a URL. If a download returns `requires_credit`, obtain approval
before repeating it with `--confirm`. Upload tools can return a browser uploader;
the CLI does not render embedded MCP apps or automatically upload `@path` values.
Visuals and other plan-restricted tools remain subject to the account's grants.

See the [common usage guide](../../apps/cli/README.md) and
[plugin development guide](../README.md).
