# MCP CLI desktop app

Built with React, TanStack Router, TanStack Query, Mantine UI, and tinyjs.
See [design.md](./design.md) for the UI design.

## Using the app

Copy the built `dist/MCP CLI.app` to your Applications folder and launch it.
You do not need Bun, Node, tinyjs, or the source repository.
The services screen opens on first launch. Click the login button for the service you want to use.
For API key services, enter a key issued by that service.

The app bundles the CLI and tool definitions for the built-in plugins. It creates the configuration directory automatically.
Use the tray's open management window action to reopen the window.
You do not need to set a CLI executable path. Use advanced settings only when you need a separate CLI.
The use default command action clears a custom executable command.

Local macOS builds currently use ad hoc signing. Public downloads require separate developer signing and notarization.

## Development

Run from the repository root.

```sh
bun install
MCP_CLI_DESKTOP_ENTRY="$PWD/apps/cli/src/main.ts" \
MCP_CLI_DESKTOP_BUN="$(command -v bun)" \
bun run --cwd apps/desktop desktop
```

Open the management window from the tray.
Start the daemon in the app, then run this in a terminal:

```sh
bun run cli demo message echo --text hello
```

Development mode uses the configured Bun executable and source CLI path.
Native builds bundle a CLI with the Bun runtime and locate it relative to the app.
The built app still runs after you move or remove the source repository.

## Features

- Tray residency, hide-on-close behavior, and separate app and daemon shutdown
- Daemon start, status, connection reset, and shutdown
- Connection and in-flight request counts, credential selection, and idle timeout display
- Per-service OAuth login, API key storage, and logout
- App launch-at-login and automatic daemon startup settings

Authentication shares the existing CLI file store.
Migration to the OS Keychain is not included.
Environment variable status reflects the environment of the CLI launched by the app.
Terminal commands receive their own environment variables separately.
OAuth login uses an external browser.
API keys pass through stdin, never command-line arguments.

## Connection contract

The CLI uses the daemon by default. You do not need to set `MCP_CLI_DAEMON=1`.
Select a direct connection with `MCP_CLI_DAEMON=0`.
If the daemon is stopped, the CLI switches to a direct connection before sending the tool request.
Tool calls are not retried automatically.
The daemon isolates pools by service, credential, authentication identity, connection settings, environment variables, and working directory.
It allows up to 32 connections, with a 60-second idle timeout.
An IPC connection maintains the lease while the CLI runs.
The idle timer starts when the CLI exits or its IPC connection closes.
Reset and shutdown wait for in-flight requests.
New requests during a reset also wait for the reset to finish.
Authentication changes reset all pooled connections.

IPC uses Unix sockets on macOS and Linux.
Windows uses named pipes.
Each request uses a daemon-specific bearer token.
On POSIX, directory permissions are 0700 and token and socket permissions are 0600.
Set an absolute path with `MCP_CLI_DAEMON_DIR`.
After an abnormal daemon exit, the next startup or app update recovers stale state.
Ownership, token, and socket files are removed only when the recorded PID is absent and the socket cannot be reached.
If the PID is alive, the socket responds, or ownership cannot be verified, recovery preserves the state and stops.
A lock protects concurrent recovery and startup. Stale locks are not deleted automatically.

## Building and verification

```sh
bun run check
cd apps/desktop
bun run build
bun run native:build
```

`bun run native:build` builds in a separate working directory, then replaces the artifacts.
On macOS, it preserves the existing `dist` and running app until signature verification finishes.
If an `.app` with the same app ID is running, it also updates that installation path.

- Block new requests and wait for in-flight app requests. Cancel unfinished logins.
- Shut down the daemon after its in-flight requests finish.
- Verify that the app and daemon have exited, then back up and replace the existing artifacts.
- Restart only the app and daemon that were running. Leave stopped apps stopped.
- Detach the restarted daemon from the build process so it survives build completion.
- Stop replacement if the running app's identity cannot be verified.
- If the new app fails its initialization check, stop the new process and restore the previous artifacts.
- If the new app cannot be stopped safely, preserve the backup without overwriting it.
- Wait up to 10 minutes for shutdown without force termination. Allow up to 30 seconds for startup verification.

Older versions without update shutdown support wait for running CLI requests, stop the daemon, then use a normal macOS quit request.
A second concurrent build is rejected.
If a forcibly interrupted build leaves `.native-build.lock`, verify that no build is running before deleting the lock directory.

`tinyjs build` builds an app for the host OS.
The macOS artifact is `dist/MCP CLI.app`.
Distribution signing and notarization require separate configuration.
Build and verify Windows and Linux versions on their respective operating systems.

Run the native smoke check from the repository root.
Use a new temporary directory to isolate it from an existing daemon.

```sh
MCP_CLI_DESKTOP_ENTRY="$PWD/apps/cli/src/main.ts" \
MCP_CLI_DESKTOP_BUN="$(command -v bun)" \
MCP_CLI_DAEMON_DIR="$(mktemp -d /tmp/mcp-native-XXXXXX)" \
TINYJS_HTML="$PWD/apps/desktop/test/smoke.html" \
apps/desktop/dist/mcp-desktop
```

The test page checks settings, service discovery, and daemon start, status, reset, and shutdown.
On completion, it prints `MCP SMOKE PASS` and exits the app.

A distribution build with the bundled CLI can also be checked with this environment.
Run without setting a development CLI path.

```sh
MCP_CLI_DESKTOP_ENTRY= \
MCP_CLI_DESKTOP_BUN= \
MCP_CLI_DAEMON_DIR="$(mktemp -d /tmp/mcp-packaged-XXXXXX)" \
TINYJS_HTML="$PWD/apps/desktop/test/packaged-smoke.html" \
apps/desktop/dist/mcp-desktop
```

This checks the default CLI path, advanced settings reset, bundled services, and daemon.
To isolate existing app settings as well, point HOME and the XDG paths to separate temporary directories.

## Icons

The source is `assets/mcp-cli.svg`.
A `>` rotated 45 degrees counterclockwise sits at the lower left of the MCP symbol.
Both elements share the same diagonal centerline.
The main icon uses a green MCP symbol and a copper `>`.
`scripts/icons.ts` generates a 1024px app PNG and a 48px tray PNG from the SVG.
No image generation model is used.

The macOS menu bar uses a monochrome template icon.
Windows and Linux trays retain both colors.
The entire symbol appears at 100% opacity while the daemon runs.
When the daemon is unreachable, only the MCP symbol drops to 50% opacity.
The `>` stays at 100% opacity in both states.
The app caches the PNG files, so they do not depend on the current working directory.

The MCP symbol comes from the [official repository's favicon](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/favicon.svg).

## Sound effects

The selected combination is startup B, hover B, click B, success A, and error A.
Sound effects are local WAV files. Playback makes no external API calls.
The sound effects toggle in settings saves immediately and defaults to on.
Turning it off blocks new sound playback.

- Play the startup sound once when a new daemon PID is detected.
- Do not play the startup sound for a daemon already running when the app opens.
- Apply hover and click sounds only to enabled buttons and links.
- Moving between child elements in the same button does not replay the hover sound.
- Rate-limit hover sounds to one every 180ms.
- Play click, success, and error sounds without waiting for earlier sounds to finish.
- Play success and error sounds when operations succeed or fail.
- Do not play error sounds for status query failures.

Run the native sound check with `test/sound-smoke.html` as `TINYJS_HTML`.
The check reads the existing sound setting and restores it on completion.

### Service icons

The service list uses bundled SVG files. Slack's `xoxp` and `xoxb` entries display personal and bot badges.

- Fish Audio: navigation SVG from the [official website](https://fish.audio)
- Linear: [official favicon](https://linear.app/static/favicon.svg)
- Notion: symbol extracted from the [logo](https://mintcdn.com/notion-demo/5YdhSbldE14t5Rna/logo/light.svg) in the [official developer documentation](https://developers.notion.com)
- Slack: [official symbol](https://a.slack-edge.com/9cc0056/marketing/img/nav/logo.svg)
- demo: existing MCP CLI app icon

For authenticated services, use the overflow menu to change the key, log in again, or log out.
Credentials supplied only through environment variables do not show a logout action.
