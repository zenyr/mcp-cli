# mcp-cli desktop UI design

This design describes a small tray-resident management app.
The app displays and controls the daemon's connection pool and service authentication.
Use tables, status dots, and short sentences without decorative dashboards.

## 1. Scope

### MVP features

1. Show daemon status, PID, and uptime.
2. Show total connections, per-service connections, and active/idle states.
3. Reset connections. The daemon waits for in-flight requests before closing connections.
4. Start and stop the daemon.
5. Show services and authentication status.
6. Perform OAuth login in an external browser.
7. Enter and save API keys.
8. Log out.
9. Configure launch at login.

### Outside the MVP

- Manually pasting redirect URLs. The desktop app uses a browser on the same device and loopback.
- Per-service connection resets. Only a full reset is available.
- Request logs, graphs, and statistics.
- Starting or stopping the daemon from the tray menu. These actions are available only in the management window.

### App and daemon relationship

- The daemon is a separate Bun process. The app communicates with it through local IPC.
- The daemon keeps running when the app exits.
- Closing the window hides it. The app process remains in the tray.
- CLI commands and output formats stay unchanged. The app does not replace the CLI.

## 2. Information architecture

```text
Tray
├─ Status line (disabled item)
├─ Open management window
└─ Quit app

Management window
├─ Daemon bar (fixed at the top of every screen)
├─ /connections   Connections
├─ /services      Services
└─ /settings      Settings

Modals
├─ OAuth login progress
├─ Save API key
├─ Confirm logout
└─ Confirm daemon shutdown
```

### Routes

Use code-based TanStack Router configuration. Use `createHashHistory()` for the desktop webview.

| Path           | Screen      | Notes                                           |
| -------------- | ----------- | ----------------------------------------------- |
| `/`            | None        | Redirect to `/connections`                      |
| `/connections` | Connections | Default screen                                  |
| `/services`    | Services    | Authentication status and login actions         |
| `/settings`    | Settings    | Launch at login, paths, and version information |

Modals are local screen state, not routes.
Opening the window from the tray preserves the last route.

## 3. Window and layout

### Dimensions

| Item                | Value                                  |
| ------------------- | -------------------------------------- |
| Default window size | 760 × 520                              |
| Minimum window size | 640 × 440                              |
| Daemon bar height   | 52                                     |
| Sidebar width       | 168                                    |
| Content padding     | 16                                     |
| Table row height    | About 36 (`verticalSpacing="xs"`)      |
| Modal width         | 420 (`size={420}`)                     |
| Base font size      | 13 (`fontSizes.sm`), secondary text 12 |

Save the last window position. Center the window on first launch.
The current `tinyjs.json` specifies `size` as `880x640`. This design recommends `760x520`.

### Structure

Use `AppShell` with `header={{ height: 52 }}` and `navbar={{ width: 168, breakpoint: 0 }}`.

```text
┌────────────────────────────────────────────────────────────────────┐
│ ● Running  PID 48213 · 2h 14m · 3 connections  [Reset] [Stop]        │ ← Daemon bar
├────────────────┬───────────────────────────────────────────────────┤
│ Connections  3 │                                                   │
│ Services       │                     Content                       │
│ Settings       │                                                   │
│                │                                                   │
│                │                                                   │
│ v0.1.0         │                                                   │
└────────────────┴───────────────────────────────────────────────────┘
```

- Use three `NavLink` items in the sidebar. Put the connection count to the right of `Connections` in a `Badge size="xs" variant="light"`.
- Put the app version at the bottom of the sidebar in `Text size="xs" c="dimmed"`.
- Use 16px icons from `@tabler/icons-react`: `IconPlugConnected`, `IconKey`, and `IconSettings`.

## 4. Theme and colors

Pass these values to `MantineProvider`:

```ts
const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "sm",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontSizes: { xs: "12px", sm: "13px", md: "14px" },
  components: {
    Button: Button.extend({ defaultProps: { size: "xs" } }),
    Badge: Badge.extend({ defaultProps: { size: "sm", variant: "light", radius: "sm" } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: "xs", fz: "sm" } }),
  },
});
```

- Follow the OS color scheme with `defaultColorScheme="auto"`.
- Avoid shadows, gradients, and large cards. Separate sections with `Paper withBorder` and `Divider`.
- Display service names, PIDs, environment variable names, and paths with `Code` or `ff="monospace"`.

### Status colors

| Status                           | Mantine color | Purpose                                        |
| -------------------------------- | ------------- | ---------------------------------------------- |
| Running, active, signed in       | `teal`        | Normal operation                               |
| Idle, stopped, no authentication | `gray`        | Normal inactive state                          |
| Starting, stopping, draining     | `yellow`      | Transition                                     |
| Unreachable, error               | `red`         | User action required                           |
| Login required                   | `orange`      | Authentication action required                 |
| Environment variable in use      | `violet`      | Environment variable overrides the saved value |

Use `ColorSwatch size={8}` for status dots. During transitions, replace the dot with `Loader size={10}`.
Always put text beside the dot. Do not communicate status through color alone.

## 5. Daemon bar

Fix the bar to the top of every screen, with status on the left and actions on the right.

### Display by state

| Daemon state  | Left text                                                   | Right buttons                                          |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `running`     | `● Running` `PID 48213 · 2h 14m · 3 connections`            | `Reset connections` `Stop daemon`                      |
| `draining`    | `◌ Draining connections` `Waiting for 2 in-flight requests` | `Reset connections` (loading) `Stop daemon` (disabled) |
| `starting`    | `◌ Starting…`                                               | `Start daemon` (loading)                               |
| `stopping`    | `◌ Stopping…` `Waiting for 1 in-flight request`             | `Stop daemon` (loading)                                |
| `stopped`     | `● Stopped`                                                 | `Start daemon`                                         |
| `unreachable` | `● Unreachable` `PID 48213`                                 | `Check again` `Stop daemon`                            |

- Use `variant="default"` for `Reset connections`. Disable it when there are no connections.
- Use `variant="subtle" color="red"` for `Stop daemon`.
- Use `variant="filled"` for `Start daemon`.
- Do not place a `CopyButton` beside the PID. Make the PID text selectable.
- Calculate uptime from `startedAt`. Refresh it every minute.

### Reset connections

Do not show a confirmation modal because reset does not interrupt in-flight requests.

1. The user clicks `Reset connections`.
2. The daemon bar changes to `draining`.
3. The daemon waits for in-flight requests, then closes all connections.
4. On completion, show a notification: `Closed 3 connections.`
5. New requests during reset open new connections, following the daemon contract.

### Stop daemon

Show a confirmation modal only when requests are in flight. Otherwise, stop immediately.

- Title: `Stop the daemon?`
- Body: `The daemon will stop after 2 in-flight requests finish. CLI commands will no longer reuse connections.`
- Buttons: `Cancel`, `Stop` (`color="red"`)

## 6. Connections screen `/connections`

### Layout

```text
3 connections · 1 active · 2 idle                 Idle connections close after 60 seconds
┌─────────┬────────────┬──────────┬──────────┬───────────┬───────────┐
│ Service │ Credential │ Status   │ Requests │ Last used │ Closes in │
├─────────┼────────────┼──────────┼──────────┼───────────┼───────────┤
│ notion  │ OAuth      │ ● active │ 1        │ Just now  │ —         │
│ slack   │ xoxb       │ ● idle   │ 0        │ 12s ago   │ 48s       │
│ slack   │ Default    │ ● idle   │ 0        │ 41s ago   │ 19s       │
└─────────┴────────────┴──────────┴──────────┴───────────┴───────────┘
```

- Use `Group justify="space-between"` for the summary line. Use `Text size="sm" fw={500}` on the left and `Text size="xs" c="dimmed"` on the right.
- Put `Table highlightOnHover stickyHeader` inside `Table.ScrollContainer minWidth={560}`.
- Sort by service name, active status first, then most recent use.
- `Requests` is the in-flight request count. Show zero with `c="dimmed"`.
- Show `Closes in` only for idle connections. Display `—` for active connections.
- Calculate `Closes in` from `idleExpiresAt` in the UI every second. Do not make IPC calls for this value.
- Show `Closes in` with `c="yellow"` at 10 seconds or less.
- On row hover, show the connection ID and opening time in a `Tooltip`: `Connection a1b2c3 · Opened at 14:02:11`.

### Credential column text

| Condition                   | Text                   |
| --------------------------- | ---------------------- |
| OAuth                       | `OAuth`                |
| Default API key             | `Default`              |
| Alternate API key (`xoxb`)  | `xoxb`                 |
| Environment variable in use | `Environment variable` |
| No authentication           | `—`                    |

### Content by state

| State                           | Content                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| Initial loading                 | Three `Skeleton` rows, height 28                                     |
| No connections                  | Empty state block                                                    |
| Daemon `stopped`                | Offline block                                                        |
| Daemon `unreachable`            | Error block                                                          |
| Query failure while daemon runs | One-line `Alert` above the table, retaining the last successful data |

Use `Stack align="center" gap={4} py={48}` for the empty state block.

- Title: `No open connections.`
- Description: `The daemon opens connections when you run CLI commands. Idle connections close after 60 seconds.`
- Example: display `mcp-cli notion search --query minutes` in `Code`.

Use the same layout for the offline block.

- Title: `The daemon is not running.`
- Description: `CLI commands still work, but open a new connection each time.`
- Button: `Start daemon`

Use `Alert color="red" variant="light"` for the error block.

- Title: `The daemon is not responding.`
- Body: `Process PID 48213 still exists. Check again or stop the daemon.`
- Buttons: `Check again`, `Stop daemon`

The query failure `Alert` reads: `Could not load connections. Retrying in 2 seconds.`

## 7. Services screen `/services`

### Layout

Create one row per credential for each service. Slack has two rows: the default key and the `xoxb` key.

```text
┌────────────┬─────────┬──────────────────────────┬─────────────┬────────────┐
│ Service    │ Method  │ Status                   │ Connections │            │
├────────────┼─────────┼──────────────────────────┼─────────────┼────────────┤
│ demo       │ None    │ ● No authentication      │ 0           │            │
│ fish-audio │ OAuth   │ ● Login required         │ 0           │ [Log in]   │
│ linear     │ OAuth   │ ● Environment variable   │ 1           │            │
│ notion     │ OAuth   │ ● Signed in              │ 1           │ [⋯]        │
│ slack      │ API key │ ● Signed in              │ 2           │ [⋯]        │
│   └ xoxb   │ API key │ ● Login required         │ 0           │ [Save key] │
└────────────┴─────────┴──────────────────────────┴─────────────┴────────────┘
```

- Above the table, use `Text size="xs" c="dimmed"` for: `Environment variables take precedence over saved credentials.`
- For alternate credential rows, replace the service name with `└ xoxb`, indented with `pl="md"`.
- Use `Badge variant="outline" color="gray"` for `Method`.
- `Status` contains a status dot and text, using the colors in section 4.
- `Connections` counts connections for that credential. Use the same query as the connections screen.
- Set the last column width to 120 and align its buttons to the right.

### States and actions

| State                  | Condition                                               | Row action                                                          |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `No authentication`    | `auth.type === "none"`                                  | None                                                                |
| `Login required`       | No saved value or environment variable                  | OAuth: `Log in`; API key: `Save key`                                |
| `Signed in`            | Saved value exists                                      | `Menu`: `Log in again`/`Change key`, `Log out`                      |
| `Environment variable` | Corresponding variable exists in the daemon environment | None. `Tooltip`: `Using the LINEAR_MCP_TOKEN environment variable.` |
| `Signing in`           | OAuth attempt in progress                               | `Log in` button loading                                             |
| `Expired`              | OAuth token refresh failed                              | `Log in again` button (`color="orange"`)                            |

- The `Menu` target is `ActionIcon variant="subtle"` with a 16px `IconDots`.
- Environment variable status uses the daemon process environment, not the app process environment. GUI apps may not receive shell environment variables.
- If the daemon cannot distinguish `Expired`, display `Signed in` in the MVP.

### Content by state

- Initial loading: five `Skeleton` rows.
- Daemon `stopped`: show the service list and authentication status. Show `—` in `Connections`. Login and logout must work without the daemon. Section 9's contract item determines whether the app accesses storage directly when the daemon is absent.
- List query failure: `Alert color="red"` with `Could not load services.` and a `Retry` button.

## 8. Authentication modals

### OAuth login

Clicking `Log in` opens the browser and a modal. Use `Modal size={420} closeOnClickOutside={false}`.

In progress:

- Title: `Log in to notion`
- Body 1: `Finish signing in through your browser. This window will close automatically when you finish.`
- Body 2 (`Text size="xs" c="dimmed"`): `If the browser does not open, open the address below.`
- Address: `TextInput readOnly` with a `CopyButton` on the right. Button text changes from `Copy` to `Copied`.
- Footer: `Loader size="xs"` with `Waiting…` on the left, and `Reopen browser` and `Cancel` on the right.

Success:

- Close the modal.
- Notification: `Signed in to notion.` (`color="teal"`)
- The daemon resets existing notion connections after waiting for in-flight requests.

Failure:

- Show `Alert color="red"` inside the modal. Title: `Could not sign in.` Body: the original daemon error message.
- Buttons: `Retry`, `Close`.

Timeout (5 minutes):

- `Alert color="yellow"`: `Login was not completed within 5 minutes.` Buttons: `Retry`, `Close`.

Cancellation:

- Ask the daemon to cancel the attempt. Close the modal without a notification.

### Save API key

Use `Modal size={420}`. Open a separate modal for each credential row.

- Title: `Save slack key` or `Save slack xoxb key`
- Input: `PasswordInput label="SLACK_MCP_TOKEN" data-autofocus`
- Description: `Saved in the mcp-cli credential store. Saved values are never displayed again.`
- If an environment variable exists, add `Alert color="violet" variant="light"`: `The SLACK_MCP_TOKEN environment variable is set. It takes precedence over the saved value.`
- Buttons: `Cancel`, `Save`. Disable `Save` if the input is blank.
- Save on Enter.
- Success notification: `Saved slack key.`
- Failure: display the daemon error message in the input's `error` prop.
- Clear the input state after saving. Never retain key values in the query cache or logs.

### Confirm logout

Use `openConfirmModal` from `@mantine/modals`.

- Title: `Log out of notion?`
- Body: `Saved credentials will be deleted. Open notion connections will close after in-flight requests finish.`
- Buttons: `Cancel`, `Log out` (`color="red"`)
- Success notification: `Logged out of notion.`
- Notification if no value was saved: `No saved credentials for notion.`

## 9. Settings screen `/settings`

Use `Stack gap="lg" maw={520}`. Separate sections with a `Text size="xs" fw={600} c="dimmed" tt="uppercase"` heading and a `Divider`.

### Automatic startup

| Setting                 | Component | Default | Description                                                         |
| ----------------------- | --------- | ------- | ------------------------------------------------------------------- |
| `Launch app at login`   | `Switch`  | Off     | `Start the app in the tray when you log in to the OS.`              |
| `Start daemon with app` | `Switch`  | On      | `Start the daemon when the app opens if it is not already running.` |

- Save `Switch` changes immediately. Disable the switch while saving.
- On failure, restore the previous value and show: `Could not update automatic startup settings.`
- Launch at login does not open the window. The app appears only in the tray.

### Information

Use a two-column `Table` without a header, with `fz="xs"`.

| Item           | Example value                                    |
| -------------- | ------------------------------------------------ |
| App version    | `0.1.0`                                          |
| Daemon version | `0.1.0` or `—`                                   |
| IPC address    | `~/.mcp-cli/daemon.sock` (named pipe on Windows) |
| Idle TTL       | `60 seconds`                                     |

Put a `CopyButton` to the right of the IPC address.
If app and daemon versions differ, show the daemon version with `c="red"`. Below the daemon bar, show an `Alert`: `Daemon version (0.1.0) differs from app version (0.2.0). Restart the daemon.`

## 10. Tray

### Menu

```text
● Daemon running · 3 connections       (disabled)
────────────────
Open management window
────────────────
Quit app
```

Status line text:

| Daemon state  | Text                             |
| ------------- | -------------------------------- |
| `running`     | `Daemon running · 3 connections` |
| `draining`    | `Draining connections`           |
| `starting`    | `Daemon starting`                |
| `stopping`    | `Daemon stopping`                |
| `stopped`     | `Daemon stopped`                 |
| `unreachable` | `Daemon unreachable`             |

- Do not put an explanation below `Quit app`. Instead, show a notification only on the first exit: `App closed. The daemon is still running.`
- Quitting the app requires no confirmation because it does not affect the daemon or in-flight requests.

### Icons

Prepare three icons. macOS uses template images, so distinguish states by shape, not color.

| State                             | Shape                              |
| --------------------------------- | ---------------------------------- |
| `running`, `draining`             | Plug inside a filled circle        |
| `stopped`, `starting`, `stopping` | Outline plug                       |
| `unreachable`                     | Outline plug with exclamation mark |

Tooltip: `mcp-cli · Daemon running · 3 connections`.

### OS behavior

| OS      | Left click             | Right click | Notes                                     |
| ------- | ---------------------- | ----------- | ----------------------------------------- |
| macOS   | Open menu              | Open menu   | No Dock icon (accessory app)              |
| Windows | Open management window | Open menu   |                                           |
| Linux   | Open menu              | Open menu   | AppIndicator may not provide click events |

### Closing the window

- The close button, `Cmd+W`, and `Ctrl+W` hide the window.
- On Windows and Linux, show an OS notification only the first time the window is hidden: `mcp-cli is still running in the tray.`
- On macOS, `Cmd+Q` quits the app without stopping the daemon.

## 11. Data contract (values required by the UI)

The UI assumes IPC returns values shaped as follows. Implementations may change field names.

```ts
type DaemonState = "running" | "draining" | "starting" | "stopping" | "stopped" | "unreachable";

type DaemonStatus = {
  state: DaemonState;
  pid?: number;
  startedAt?: string; // ISO
  version?: string;
  address: string; // Socket path or named pipe
  idleTtlMs: number; // 60000
  inFlight: number; // Used in draining and stopping messages
};

type PooledConnection = {
  id: string;
  service: string;
  credential?: string; // Alternate credential such as "xoxb", undefined for the default
  state: "active" | "idle";
  inFlight: number;
  openedAt: string;
  lastUsedAt: string;
  idleExpiresAt?: string; // Only when idle
};

type CredentialStatus = "none" | "signedOut" | "signedIn" | "envOverride" | "expired";

type ServiceCredential = {
  service: string;
  credential?: string;
  auth: "oauth" | "apiKey" | "none";
  env?: string; // API key variable or token override variable name
  status: CredentialStatus;
};

type LoginAttempt = {
  id: string;
  url: string;
  state: "waiting" | "succeeded" | "failed" | "timedOut" | "cancelled";
  error?: string;
};
```

Daemon contract checks for implementers:

1. Verify that the CLI connects directly when the daemon is stopped. The offline block's description depends on this behavior.
2. Verify that daemon shutdown waits for in-flight requests. The shutdown confirmation modal depends on this behavior.
3. Reset connections for the affected credential after login, key storage, or logout. Otherwise, the pool reuses old credentials.
4. Decide which process handles authentication actions when the daemon is stopped. Direct access to the `@mcp-cli/auth` store from the app process is recommended.
5. Run OAuth attempts in either the daemon or the app process, never both. Loopback ports, such as fish-audio `18923`, must not conflict.

## 12. Query and refresh policy

### Query keys

```ts
const keys = {
  status: ["daemon", "status"] as const,
  connections: ["daemon", "connections"] as const,
  services: ["services"] as const,
  login: (id: string) => ["auth", "login", id] as const,
  settings: ["settings"] as const,
};
```

### Query options

| Query         | `refetchInterval` (window visible) | Window hidden | `staleTime` | `retry` |
| ------------- | ---------------------------------- | ------------- | ----------- | ------- |
| `status`      | 2000                               | Stop          | 1000        | `false` |
| `connections` | 2000, `false` if `stopped`         | Stop          | 1000        | 1       |
| `services`    | None                               | Stop          | 30000       | 1       |
| `login(id)`   | 1000, `false` in a terminal state  | Continue      | 0           | `false` |
| `settings`    | None                               | Stop          | `Infinity`  | 1       |

- Set `QueryClient` defaults to `refetchOnWindowFocus: true` and `refetchIntervalInBackground: false`.
- Detect a hidden window through webview `visibilitychange`. Call `focusManager.setFocused(false)` while hidden.
- Refetch `status`, `connections`, and `services` immediately when the window reopens.
- Convert connection-refused failures in `status` queries into `{ state: "stopped" }`, not errors. This is why `retry` is `false`.
- Reduce `refetchInterval` to 500 while `status` is `starting`, `stopping`, or `draining`.
- If the daemon supports IPC event subscriptions, call `setQueryData` from events. Increase `refetchInterval` to 15000 as a fallback.
- The native app queries tray status separately every 5 seconds. The tray updates even while the webview is hidden.

### After mutations

| Mutation          | Immediate UI update               | Invalidate on completion              | Timeout                  |
| ----------------- | --------------------------------- | ------------------------------------- | ------------------------ |
| Start daemon      | `status.state = "starting"`       | `status`, `connections`               | 10 seconds               |
| Stop daemon       | `status.state = "stopping"`       | `status`, `connections`               | None (wait for requests) |
| Reset connections | `status.state = "draining"`       | `status`, `connections`               | None (wait for requests) |
| Start OAuth       | Row button loading, open modal    | On success: `services`, `connections` | 5 minutes                |
| Save key          | Modal button loading              | `services`, `connections`             | 10 seconds               |
| Log out           | Row button loading                | `services`, `connections`             | 10 seconds               |
| Change settings   | Update `Switch` value immediately | Restore previous value on failure     | 10 seconds               |

- If daemon startup exceeds 10 seconds, show: `The daemon did not start within 10 seconds.` Subsequent query results determine its state.
- Use `@mantine/notifications` with position `bottom-right`, `autoClose={3000}`, and `autoClose={6000}` for errors.

## 13. Keyboard

| Key                    | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| `Cmd/Ctrl+1`, `2`, `3` | Navigate to connections, services, and settings       |
| `Cmd/Ctrl+R`           | Refetch the current screen's queries                  |
| `Cmd/Ctrl+W`           | Hide the window                                       |
| `Esc`                  | Close the modal (equivalent to `Cancel` during OAuth) |

Register shortcuts with `useHotkeys` from `@mantine/hooks`.

## 14. Time formatting

- Use `Intl.RelativeTimeFormat("ko", { numeric: "auto" })` for relative times. Display the localized equivalent of `Just now` below 5 seconds.
- Display uptime in the localized equivalent of `2 hours 14 minutes`, `3 minutes`, or `1 day 4 hours`. Omit seconds.
- Display time until closure in the localized equivalent of `48 seconds`. At zero or below, show the localized equivalent of `Closing`.

## 15. Proposed file structure

Keep each file at 350 lines or fewer. Centralize UI copy in `copy.ts`.

Keep the scaffold's `src/main.tsx` and `src/App.tsx` as entry points. Paths below are relative to `src/`.

Additional dependencies:

- `@mantine/notifications`: success and error notifications
- `@mantine/modals`: logout and daemon shutdown confirmations

```text
apps/desktop/src/
├─ main.tsx              MantineProvider, QueryClientProvider, RouterProvider
├─ theme.ts              Theme from section 4
├─ router.tsx            Route definitions, hash history
├─ copy.ts               UI copy
├─ ipc.ts                IPC client and types from section 11
├─ queries.ts            Query keys, useQuery and useMutation hooks
├─ time.ts               Time formatting from section 14
├─ shell/
│  ├─ app-shell.tsx      AppShell, sidebar
│  └─ daemon-bar.tsx     Section 5
├─ connections/
│  ├─ connections-page.tsx
│  └─ connection-states.tsx  Empty, offline, and error blocks
├─ services/
│  ├─ services-page.tsx
│  ├─ oauth-modal.tsx
│  └─ api-key-modal.tsx
└─ settings/
   └─ settings-page.tsx
```

Write components as arrow functions. Do not use `any` or non-null assertions.
Narrow IPC response status strings in a single small type guard function.

## Sound settings

Put a dedicated sound `Paper` between the existing settings `Paper` and the information `Stack` at the bottom.
The sound effects toggle saves immediately and defaults to on.
Below the toggle, show sound names and working preview buttons in this order: startup, success, error, click, hover.
Disable preview buttons while muted.
Do not add a sound selector or volume slider.
Exclude the preview area from normal click and hover sounds.
