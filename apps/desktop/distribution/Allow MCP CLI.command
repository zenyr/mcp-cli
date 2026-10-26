#!/bin/bash
set -euo pipefail

app="${1:-/Applications/MCP CLI.app}"
if [[ "$app" != "/Applications/MCP CLI.app" && "$app" != "$HOME/Applications/MCP CLI.app" ]]; then
  printf 'Only MCP CLI in /Applications or ~/Applications is supported.\n' >&2
  exit 1
fi
if [[ ! -d "$app" || -L "$app" || -L "$(dirname "$app")" ]]; then
  printf 'First drag MCP CLI.app into Applications. Symbolic links are not supported.\n' >&2
  exit 1
fi
identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
if [[ "$identifier" != "app.mcp-cli.desktop" ]]; then
  printf 'The installed app is not MCP CLI. No changes were made.\n' >&2
  exit 1
fi
/usr/bin/codesign --verify --deep --strict "$app"
printf '\nApp: %s\n' "$app"
printf 'This app is not notarized by Apple. Its ad hoc signature does not verify the publisher.\n'
printf 'Continue only if you trust the download source.\n'
printf 'This removes the download quarantine attribute from this app and its contents.\n'
printf 'It does not disable Gatekeeper globally and does not use administrator privileges.\n'
printf 'Type ALLOW to consent, or press Return to cancel: '
IFS= read -r consent || exit 1
if [[ "$consent" != "ALLOW" ]]; then
  printf 'Cancelled. No changes were made.\n'
  exit 0
fi
/usr/bin/xattr -drs com.apple.quarantine "$app"
printf 'MCP CLI is allowed. You can now open it from Applications.\n'
