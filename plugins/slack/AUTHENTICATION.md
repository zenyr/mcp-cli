# Slack authentication

PKCE protects an OAuth authorization-code exchange. Token rotation replaces expiring
access tokens using refresh tokens. These are separate settings and mechanisms.
This implementation runs inside the bundled CLI. It does not start a Python server.

## Supported configurations

| App configuration                                        | Authentication                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| No local OAuth configuration                             | Existing environment variables and saved tokens                         |
| PKCE enabled, registered localhost redirect, user scopes | Browser login without a Client Secret                                   |
| PKCE disabled or unknown                                 | Token input; browser login explains the missing setting                 |
| Bot identity                                             | Existing `--xoxb` token input; desktop PKCE does not request bot scopes |
| Internal or Marketplace app with MCP access enabled      | MCP browser login can be attempted                                      |
| Unlisted distributed app or MCP access disabled          | MCP browser login is blocked locally                                    |

The optional **auto** mode reads Slack App settings with `apps.manifest.export`.
It needs an App configuration token with `app_configurations:read` and access to that App.
Ordinary user/bot tokens cannot perform this inspection. The application never changes Slack settings.
Checkboxes in manual browser mode record the operator's confirmation, not verification by Slack.
Successful credential storage is shown as **stored**, never as a successful connection.

## Configure Slack first

1. Open the intended Slack App in the Slack developer dashboard.
2. Record its **App ID** and **Client ID** from Basic Information.
3. Confirm the intended workspace ID, beginning with `T`.
4. Review **OAuth & Permissions > PKCE** with the App owner before enabling it.
   Enabling PKCE makes the app a public client and cannot be undone without Slack support.
5. Register an exact redirect such as `http://localhost:8765/callback`.
   This client supports HTTP localhost with a fixed unprivileged port and no query or fragment.
   It does not implement custom URI callbacks or remote HTTPS callbacks.
6. Add the required **User Token Scopes**, granting only the operations you need.
   Do not include Sign in with Slack scopes (`openid`, `email`, `profile`).
7. For MCP, confirm the app is internal or Marketplace-published and MCP access is enabled
   (`settings.is_mcp_enabled` in the app manifest). Check workspace approval and IP restrictions.
8. If rotating tokens are needed for localhost login, review the separate token rotation setting.
   The client follows the actual token response and does not assume every login rotates tokens.

MCP search scopes include `search:read.public`, `search:read.private`, `search:read.im`,
`search:read.mpim`, `search:read.files`, and `search:read.users`, according to the tools needed.
Channel history requires its corresponding `channels:history`, `groups:history`,
`im:history`, or `mpim:history` scope. Web API message search uses `search:read`.
Sending messages requires `chat:write`; do not request it just to check a connection.
Consult each method's scope documentation before enabling additional actions.

## Configure the desktop app

1. Open Services > **Slack login settings**.
2. Select MCP or Web API and choose browser login or token input for that target.
3. For browser login, enter the App ID, Client ID, workspace ID, registered redirect,
   and user scopes. Confirm only settings you have checked in Slack.
4. Save settings, then start login for that target and approve it in your browser.
5. Select **Check connection**. MCP initialization/tool listing and Web API `auth.test`
   are read-only checks. Their success does not guarantee access to every method or channel.
6. For bot access, save the bot token in the existing `xoxb` row.
   To use a manually supplied user token for a target, select token input and save settings.

### Detect settings and choose authentication automatically

1. Select **auto**, enter the App ID and other login fields, and save settings.
2. Enter an App configuration token in the separate password field and select **Detect**.
   The UI also keeps user-token and bot-token save buttons available.
3. The client reads `oauth_config.pkce_enabled`, `settings.token_rotation_enabled`,
   MCP availability, redirect URLs, and user scopes from the exported manifest.
4. PKCE enabled selects browser credentials. PKCE disabled selects the existing user token.
   Missing fields, missing permissions, and failed requests remain **unknown** and block automatic selection.
5. Before auto-mode browser login, the client reads the manifest again and checks the selected redirect and scopes.
   Runtime connections use the last successful inspection; the UI displays its timestamp.

The token rotation setting and the current credential's refresh capability are displayed separately.
Token responses remain authoritative for storing and refreshing credentials, whether rotation is enabled or disabled.
A failed inspection invalidates cached evidence; it does not change Slack settings or delete user credentials.
The inspection token is stored under an App-specific name in the existing 0600 credential store.
Only selected public settings are retained from the manifest, not the full manifest or credential.
The lookup is bound to App ID; copy Client ID from the same App because the manifest does not provide it.
The token is never sent in a URL. Deleting it clears detection evidence, but preserves login tokens.

CLI equivalents:

```sh
mcp-cli auth detect slack --web --save-token
mcp-cli auth detect slack --web
mcp-cli auth detect slack --web --forget
```

`--save-token` reads a hidden prompt. Do not pass the token as a command argument.
Use `"method": "auto"` in the settings JSON to select detected behavior.
See the [export API](https://docs.slack.dev/reference/methods/apps.manifest.export/)
and [manifest fields](https://docs.slack.dev/reference/app-manifest/).

No Client Secret is requested, stored in configuration, or embedded in the application.
Apps that require confidential OAuth must use token input in this client.

## CLI and shared storage

Provide settings JSON on stdin; do not put secrets in this file:

```json
{
  "mcp": { "method": "token" },
  "web": {
    "method": "pkce",
    "clientId": "123.456",
    "appId": "AEXAMPLE",
    "teamId": "TEXAMPLE",
    "redirectUri": "http://localhost:8765/callback",
    "scopes": ["channels:read"],
    "pkceEnabled": true
  }
}
```

Replace the example identifiers and scopes with your App's values.

```sh
mcp-cli auth configure slack < slack-settings.json
mcp-cli auth status slack
mcp-cli login slack --browser --web
mcp-cli login slack --browser --mcp
mcp-cli auth status slack --check
mcp-cli logout slack --web
mcp-cli logout slack --mcp
```

Use `--no-browser` to open the displayed URL yourself and paste the full callback URL.
Token input is unchanged: `mcp-cli login slack`, `--xoxp`, and `--xoxb` use hidden stdin.
`mcp-cli logout slack` and `mcp-cli logout slack --xoxb` still remove their respective
manual tokens. Targeted `--mcp` / `--web` logout removes only browser credentials.
Logout is local deletion; it does not call Slack `auth.revoke` or uninstall the app.
Revoke authorization separately in Slack when required.

The desktop and CLI share `$XDG_CONFIG_HOME/mcp-cli` or `~/.config/mcp-cli`:

- `settings/slack.json` contains public configuration and its revision.
- `credentials/slack.json` and `credentials/slack--xoxb.json` remain unchanged.
- `credentials/slack-oauth-mcp.json` and `credentials/slack-oauth-web.json` hold separate OAuth credentials.
- Cross-process locks and attempt markers coordinate refresh, login, and logout.

Files use mode 0600 in 0700 directories. This preserves the existing file-backed
credential store; it does not introduce OS Keychain storage or encryption at rest.
Environment variables retain highest priority. Without configuration, manual tokens
behave exactly as before. With configuration, each target explicitly selects its
manual token or its own browser credential. There is no silent fallback after OAuth failure.

Every settings save changes the configuration revision and requires browser credentials
to be obtained again for both targets. Existing files are retained, not migrated or deleted.
App, workspace, target, scopes, callback, and revision bind each browser credential.
The response workspace must match; an App ID in the response must match as well.
Refreshes run under a per-target lock and preserve the cache identity while rotating tokens.
Invalid refresh grants mark credentials as needing login without erasing them.
No refresh token means an expired access token requires a new login.

## Protocol evidence and verification limits

The [Slack PKCE guide](https://docs.slack.dev/authentication/using-pkce/) permits
public-client authorization-code exchange and refresh without a Client Secret.
Desktop redirects cannot request bot scopes. PKCE-enabled apps have refresh tokens
that expire after 30 days; revocation or refresh rejection requires login again.

The [MCP guide](https://docs.slack.dev/ai/slack-mcp-server/) specifies
`https://slack.com/oauth/v2_user/authorize` and
`https://slack.com/api/oauth.v2.user.access`. The MCP flow passes user permissions in `scope`.
The Web API flow uses `https://slack.com/oauth/v2/authorize` with `user_scope` and
`https://slack.com/api/oauth.v2.access`, whose user credentials can be nested under `authed_user`.

The [MCP metadata](https://mcp.slack.com/.well-known/oauth-authorization-server) observed
during development advertised S256 and refresh grants, but only `client_secret_post`
for token authentication. The MCP guide also points desktop clients to PKCE.
These sources do not prove that a particular App is enabled for public-client MCP OAuth.
The client attempts PKCE only after explicit configuration and reports rejection without fallback.

The shared user-token and scope model suggests that a token with the required grants
can cover both MCP and Web API. This is an inference, not a verified promise for this App.
Possessing a user token alone does not prove both access paths.
This client deliberately keeps browser credentials for the two targets separate;
it does not copy or reuse one target's OAuth token for the other target.

Automated tests use generated dummy credentials and local callback listeners.
No real Slack login, workspace approval, token refresh, message send, or write operation
was verified during implementation. Run the two explicit connection checks after real login.
