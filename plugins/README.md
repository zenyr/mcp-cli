# Plugin development guide

Service-specific connection settings and command mappings live in `plugins/<service>`.
See the [MCP CLI guide](../apps/cli/README.md) for common commands.
See [catalogs and packages](MARKETPLACE.md) for installation, metadata-only Git catalogs,
independent releases, managed runtimes, and local development.

## Service guides

- [Notion](notion/README.md): pages, databases, calendars, and comments
- [Linear](linear/README.md): issue management and authentication
- [Suno](suno/README.md): music generation, library, voices and visuals
- [Slack](slack/README.md): messaging tools and token settings
- [Fish Audio](fish-audio/README.md): speech generation, transcription, and media operations
- [Perplexity](perplexity/README.md) (service `pplx`): web search, cited answers, and deep research with an API key or browser OAuth
- [Fast Semble](fast-semble/README.md): local code search through a reusable Semble MCP session
- [Claudia](claudia/README.md): read-only gallery, character canon, and filmmaking guides without an account
- [mem](mem/README.md): workspace-only search and reads over local `mem` records
- `demo` and `demo-auth`: hidden plugins for tests and host contract checks. Set `MCP_CLI_INTERNAL_PLUGINS=1` to use them.
  `demo` is a local stdio MCP server. `demo-auth` covers API key alternates, `AuthSupport` and a Web API.

## Static generation

```bash
export MCP_CLI_INTERNAL_PLUGINS=1

# Read tool definitions from the server.
bun run generate demo

# Use saved definitions without connecting to the server.
bun run generate demo --snapshot plugins/demo/src/tools.json

# Check for changes without writing files.
bun run generate demo --snapshot plugins/demo/src/tools.json --check
```

Generation writes the plugin's `src/tools.json` and `src/generated.ts`.
The CLI locates the output directory from the plugin package's `package.json`.
An installed catalog plugin owns its service at runtime and hides the workspace package of the same service.
`mcp-cli plugins` lists the hidden package as `workspace (shadowed)`.
`generate` still targets the workspace package, so checks in a checkout compare against repository files.
`generate` and `--check` print the snapshot path they used.
Generated files contain only server tool definitions and input types. The generated manifest's `version` is `2`.
At runtime, the CLI loads the manifest through the `@mcp-cli/plugin-<service>/generated` export and validates it with `decodeManifest`.
Then `applyCustomizations` applies the plugin's `commands`.
Changes to plugin paths, descriptions, examples, and rules take effect on the next run without regeneration.
Generated manifests with `version: 1` produce a usage error. Regenerate them with `mcp-cli generate <service>`.
Tools are sorted by name, so changes to the server's list order produce identical `tools.json` and code.
Generation fails if the server returns no tools.
Duplicate command paths, parent/child command conflicts, reserved command conflicts, and mappings to nonexistent tools are errors.
`applyCustomizations` checks these conditions during both generation and execution.
Do not run concurrent generation jobs for the same plugin.

Generated code does not export call functions. All tool calls go through `runService`, which applies input validation and `beforeCall` policies.
Per-tool input types, such as `DemoEchoInput`, are exported for type references.

## Adding a plugin

1. Create a workspace package in `plugins/<service>`.
   Point `exports["."]` to the plugin module.
2. Declare `"mcp-cli": { "plugin": true, "service": "<service>" }` in `package.json`.
   If `service` is omitted, the CLI reads the plugin module and uses its `name`.
   Add `"hidden": true` to keep a test plugin out of end-user discovery and release catalogs.
   `MCP_CLI_INTERNAL_PLUGINS=1` shows hidden plugins, and `only` shows nothing else.
   Add `"workspaceOnly": true` when the plugin needs the checkout. Release builds skip it and reject it in `MCP_CLI_BUNDLE_PLUGINS`.
3. Create the default export with `definePlugin` from `@mcp-cli/core`. Its `name` must match `service`.
4. Run `bun run generate <service>` to generate static definitions.
5. Run `bun run cli plugins` to check discovery and generation status.
6. Test command mappings in `plugins/<service>/test` with `recordingPorts` from `@mcp-cli/runtime/testing`.
   Declare every imported workspace package in `devDependencies` so Turborepo reruns the tests when it changes.

Do not add plugin dependencies to the CLI package. The CLI discovers marked packages in these locations:

1. Workspace packages listed in the root `package.json`
2. Direct entries and one level of scoped directories in `node_modules` above the CLI
3. The `plugins` list in the user configuration file

The configuration path is `$MCP_CLI_CONFIG`, or `$XDG_CONFIG_HOME/mcp-cli/config.json` when unset.
The default is `~/.config/mcp-cli/config.json`. Entries are package names, absolute paths, or `~` paths.

```json
{ "plugins": ["@acme/mcp-cli-plugin-linear", "~/src/mcp-cli-plugin-slack"] }
```

Invalid configuration produces a usage error (exit code 2) that includes the file path.
If two locations provide the same service name, discovery fails and reports both locations.
Service names cannot be `help`, `generate`, `plugins`, `workspaces`, `login`, `logout`, `auth`, `desktop`, `daemon`, or `mcp-cli`.
Discovery, `plugins init`, catalog installs, and linked plugins share this list (`apps/cli/src/reserved.ts`).

When the package directory is writable, generated files go to `src/generated.ts` and `src/tools.json`.
Otherwise, as with packages inside `node_modules`, they go to `$XDG_CACHE_HOME/mcp-cli/<service>/`.
The default cache is `~/.cache/mcp-cli/<service>/`. Runtime lookup checks the package first, then the cache.

```typescript
import { definePlugin } from "@mcp-cli/core";

export default definePlugin({
  name: "issues",
  summary: "Issue management tools",
  commands: {
    "search-issues": {
      path: ["issue", "search"],
      summary: "Search issues",
      examples: ["issues issue search --query bug"],
    },
  },
  groups: { issue: "Search and retrieve issues" },
  quickstart: [{ command: "issue search --query bug", summary: "Find open bugs" }],
  connection: () => ({ type: "stdio", command: "issue-mcp" }),
});
```

Use `commands` to add descriptions, examples, and cautions.
A `summary` appears in default help. The original tool description appears in `--help=full`.
`groups` adds a one-line description to a space-separated group path, such as `"media image"`.
`quickstart` lists recommended commands under `Start here` in root help.
Entries in `groups` or `quickstart` that reference nonexistent groups or commands produce runtime errors.
If the server hides a tool based on permissions, set `optional: true` on its mapping.
When that tool is absent, the mapping and its related `groups` and `quickstart` entries are omitted from help.
Use `beforeCall(command, input)` for service-specific pre-call checks.
Use `formatResult(result, hostFormat)` for service-specific plain-text output; return `undefined` to keep host formatting.
Call `hostFormat(result)` to extend the default plain-text output instead of replacing it.
The host bypasses this formatter for `--json`, which preserves the full MCP result.
Mapped commands and `call` commands undergo the same checks.
`connection(env)` reads environment variables at runtime and may return a `Promise`. Credentials never enter generated output.
`sanitizeTools(tools)` removes account-specific metadata before writing snapshots and generated modules, for both live and snapshot-based generation.

## Local file uploads

URL fields declared in a plugin's `uploads` interpret `@path` values as local files.
Other fields pass `@` through unchanged. Use `--input -` or `--input-file` to supply file contents as input values.

```bash
fish-audio transcription create --audio-url @./meeting.m4a
fish-audio voice clone --audio-urls '["@./a.wav","@./b.wav"]' --confirm-voice-rights
```

- The CLI reads all files before connecting to the server. Unreadable files produce a usage error (exit code 2).
- Upload fields validate `format` and `pattern` against the actual URL after upload.
  Declare these constraints directly on the field. Declarations containing `allOf`, `anyOf`, `oneOf`, `not`, `$ref`, or `if` are rejected.
- The plugin's `uploadFile(file, { callTool, putBytes })` selects an upload destination and returns the URL for the tool.
  Plugins do not access the network directly. The CLI's `putBytes` adapter performs HTTP PUT requests.
- Duplicate-call keys use the file content's SHA-256 instead of the upload URL. Rejected calls do not upload files.
- Connection or upload failures allow the same call again because the tool has not been called.
- PUT error messages do not include signed upload URLs.

## Workspace support

A plugin can opt into multiple independently authenticated workspaces:

```typescript
workspaces: { credentialEnv: ["MY_SERVICE_TOKEN"] },
```

List every environment variable that supplies credentials in `credentialEnv`.
The host retains those variables for the legacy workspace and removes them for additional workspaces.
Endpoint and other non-credential variables remain available.
Installed-plugin credential namespaces still apply before the workspace namespace.

The host populates `plugin.workspace` and the workflow context’s `workspace` with the selected stable ID and local name.
Keep one plugin and one generated command catalog for all workspaces.
Plugins should use the supplied token and settings stores instead of constructing global secret paths.
Those stores scope every read, write, deletion, and lock to the selected workspace.
The existing Slack user/bot and MCP/Web choices operate within each workspace.
