# Plugin catalogs and packages

The desktop app manages catalogs, installation, activation, credentials, and service commands.
The standalone host contains the runtime, not service implementations.
Its adjacent `mcp-cli.plugins` directory contains the default catalog and independent packages.
Ship that directory together with the executable; the desktop build does this automatically.
No catalog is registered automatically. The included catalog appears as a recommendation.
Loading that recommendation saves the catalog; installing its packages remains a separate action.
Installing or refreshing a catalog never imports plugin code.

## User workflow

1. Open **Plugins**, load a recommended catalog or add an HTTPS Git repository, and select a plugin.
2. Review its permissions and select **Agree and install** to install and activate it together.
3. Open **Services** to log in.
4. Select **Register in PATH** on the Plugins page, then open a new terminal.
5. Run the service command, such as `linear issue list`.

The app creates service wrappers in `~/.local/bin` on macOS/Linux and
`%LOCALAPPDATA%/MCP CLI/bin` on Windows. POSIX wrappers forward arguments through
`exec`; Windows wrappers use `.cmd`. The app never overwrites an unowned command
file or removes a managed file that the user has edited.
PATH registration updates the current shell's startup file on POSIX and the user
environment on Windows. Existing terminal processes retain their original environment.

Disabling blocks subsequent discovery and removes unmodified command wrappers.
Existing daemon calls drain during the connection reset. A direct CLI call that
already started can finish. Removing a plugin keeps its credentials and cached
objects, so removal cannot delete files under a running process or another plugin.

## Metadata repository

Public GitHub and Forgejo repositories use the same HTTPS Git interface.
No provider-specific API, Git executable, build hook, or install script runs on the user's machine.
Private repository authentication and SSH catalog URLs are not supported in this version.
Local Git repositories are accepted for development; the app reads their committed HEAD.
Uncommitted catalog edits do not become an update.

Commit a `marketplace.json` at the repository root:

```json
{
  "schemaVersion": 1,
  "name": "Example tools",
  "plugins": [
    {
      "id": "example.hello",
      "service": "hello",
      "name": "Hello",
      "description": "Echo a message",
      "version": "1.0.0",
      "permissions": {
        "localCode": true,
        "network": [],
        "filesystem": []
      },
      "artifacts": [
        {
          "url": "https://downloads.example.com/hello/1.0.0.tar.gz",
          "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS",
          "platform": "any",
          "arch": "any"
        }
      ]
    }
  ],
  "revoked": []
}
```

Keep executable code in release artifacts or another HTTPS file host, outside the catalog.
Supported platforms are `any`, `darwin`, `linux`, and `win32`.
Supported architectures are `any`, `arm64`, and `x64`.
The most specific matching artifact wins; ambiguous matches fail.
HTTPS redirects must remain HTTPS. Embedded URL credentials are rejected.
Local catalogs may reference `file:` artifacts for offline testing.

Catalog changes only update the available list. Installation verifies the archive's
SHA-256 and its identity and permissions against the selected catalog entry.
The app stores the repository URL, commit, package identity, and artifact hash.
The app combines consent, installation, and activation for both installs and updates.
CLI installation stays inactive unless `--allow-local-code` grants execution and activates it.
One installed plugin owns each service command; competing catalogs cannot replace it.

No signing keys are pinned. The catalog repository's write access is the trust boundary.
A hash verifies consistency with the catalog; an attacker controlling that repository
can replace both a download URL and its hash. Use protected branches and review catalog changes.

To block a compromised artifact, publish its exact identity and hash:

```json
{
  "id": "example.hello",
  "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS",
  "reason": "This release was withdrawn; install the replacement."
}
```

Put this object in `revoked`. Refreshing the catalog disables matching installations
and removes their managed commands. Offline clients only know their last fetched catalog.

## Develop a plugin

The host's administration commands remain available through `mcp-cli`:

```sh
mcp-cli plugins init hello /absolute/path/hello-plugin
mcp-cli plugins link /absolute/path/hello-plugin
mcp-cli plugins enable hello --allow-local-code
mcp-cli plugins commands
hello message echo --text 'Hello'
```

The template includes `plugin.json`, `manifest.json`, and a self-contained `server.mjs`.
Code changes in a linked folder apply on the next CLI run. Relink after changing
the descriptor or tool definitions. Source development requires Bun; end users do not.

Pack the folder and print its catalog entry:

```sh
mcp-cli plugins pack /absolute/path/hello-plugin /absolute/path/hello-1.0.0.tar.gz
```

Upload the archive, replace the printed placeholder URL, and commit the metadata.
Packages contain only regular files and directories. Symlinks, hardlinks, special
files, duplicate paths, and paths escaping the package root are rejected.
Limits are 64 MiB downloaded, 256 MiB expanded, and 10,000 archive entries.
The format is a regular tar or gzip-compressed tar, not ZIP.

## Package contract

`plugin.json` has `schemaVersion: 1`, the same identity and permissions as the catalog,
and an `implementation`. `manifest.json` contains the version-2 generated tool manifest
used by the existing CLI. It must name the same service.
Optional `commands`, `groups`, and `quickstart` in `plugin.json` customize declarative plugins.

Supported implementations:

| Implementation                                                                  | Package contents                               | Runtime owner        |
| ------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------- |
| `{"type":"mcp","server":{"type":"http","url":"https://example.com/mcp"}}`       | JSON metadata and tool definitions             | Host HTTP transport  |
| `{"type":"mcp","server":{"type":"stdio","runtime":"bun","entry":"server.mjs"}}` | Bundled, self-contained JavaScript server      | Host's embedded Bun  |
| `{"type":"mcp","server":{"type":"stdio","runtime":"native","entry":"server"}}`  | Executable and required files for the platform | Host process manager |
| `{"type":"module","entry":"plugin.mjs"}`                                        | Bundled default export using `definePlugin`    | Host plugin loader   |

Bundle JavaScript dependencies before publication. Runtime entry files must start
the server when imported; do not guard startup on `import.meta.main`.
For existing TypeScript plugins, bundle with `bun build --target bun` and include the
generated manifest as JSON. The default packages demonstrate this build path.
Module plugins retain custom policies, workflows, upload handling, and authentication.
They run only after activation and can execute arbitrary code with user permissions.

A declarative implementation can declare `auth` with `none`, `apiKey`, or `oauth`.
An API key declaration specifies its `env` field; the host supplies the saved token.
An OAuth declaration may specify `scopes`, `clientName`, and `clientId`.
An HTTP server's hostname must appear in `permissions.network`.
Catalog-installed plugins have separate credential namespaces, even when a different
catalog later installs the same service name. They do not inherit host API-key environment
variables. Default plugins retain their existing credential storage for compatibility.

For Python or another external runtime, replace the `runtime` string with:

```json
{
  "kind": "managed",
  "id": "example.python-3.13.0",
  "executable": "bin/python3",
  "artifacts": [
    {
      "url": "https://downloads.example.com/python-3.13.0-macos-arm64.tar.gz",
      "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS",
      "platform": "darwin",
      "arch": "arm64"
    }
  ]
}
```

The app downloads and verifies this runtime, shares it by content hash, and launches
the declared executable with the package entry file and optional `server.args`.
Publish a relocatable, self-contained runtime archive with no install scripts or symlinks.
Neither Node nor Python is installed globally. Runtime downloads must satisfy the same
archive limits as plugin downloads. Managed runtimes are prepared when installing a package
or connecting a development folder.

`permissions.network` and `permissions.filesystem` disclose intended access; they are
not OS sandbox rules. `localCode: true` is mandatory for modules and local servers.
Activation requires explicit consent to user-account-level code execution.
Do not describe a plugin as sandboxed. Declarative remote plugins do not execute downloaded code.

## Authentication settings

Module plugins can declare `authSupport.fields` with `path`, `label`, optional
`description`, and type `text`, `boolean`, `strings`, or `select`.
Select fields provide `options: [{"value":"...","label":"..."}]`.
The desktop app renders these fields and routes each status target to the plugin's
authentication implementation; it does not import service-specific source types.

## Administrative commands

```sh
mcp-cli plugins list --json
mcp-cli plugins catalog recommended
mcp-cli plugins catalog add builtin
mcp-cli plugins catalog add https://git.example.com/team/catalog.git
mcp-cli plugins catalog refresh <catalog-id>
mcp-cli plugins install <catalog-id> <plugin-id>
mcp-cli plugins install <catalog-id> <plugin-id> --allow-local-code
mcp-cli plugins enable <service> --allow-local-code
mcp-cli plugins disable <service>
mcp-cli plugins remove <service>
mcp-cli plugins catalog remove <catalog-id>
```

State and immutable objects live beside the selected configuration at
`plugins/state.json` and `plugins/objects/<sha256>/`.
Mutations are serialized; readers see an atomic state file.
An interrupted process can leave `plugins/operation.lock` with its PID and start time.
Confirm that its owner is no longer running before manually removing that lock.
Never remove a live operation's lock.
