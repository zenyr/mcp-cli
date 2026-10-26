---
name: tinyjs
description: "Build/modify tinyjs desktop apps: txiki.js backend + native webview, macOS and beta Windows/Linux. Use for tinyjs.json projects, tinyjs/tiny.api/dev/build requests, or Electron-to-tinyjs ports."
---

# Building tinyjs apps

tinyjs (https://tinyjs.app, repo tarwin/tinyjsapp): ~6 MB apps, **txiki.js backend** with full file/socket/process/FFI access + **native webview**: WKWebView/macOS, WebView2/Windows, WebKitGTK 4.1/Linux (last two beta). Private socket, no HTTP server/ports. Page has NO system access; privileged operations cross `tiny.api`. Escape all `innerHTML` interpolations.

Release 0.34.0. Minimums: macOS 14+ universal; Windows 10/11 + WebView2; Linux glibc 2.35+ (Ubuntu 22.04 / Debian 12 / Mint 21+).

## Read the reference for the job at hand

- doing: any API beyond the basics below (windows, menus, tray, clipboard, audio, permissions, system…); read: references/api.md
- doing: per-OS support, Windows/Linux quirks, capability gating; read: references/platforms.md
- doing: starting a tray app, desktop pet/overlay, media app, document app, site wrapper, agent app; read: references/recipes.md
- doing: shipping: build/sign/notarize, per-OS packaging, auto-update manifests; read: references/release.md
- doing: porting from Electron (API map, what won't work); read: references/electron-migration.md
- doing: deciding where code runs, wire/binary payloads, throttling, memory; read: references/performance.md

## Commands

```sh
tinyjs new <dir>    # scaffold (zero dependencies)
tinyjs new <dir> --template react-ts|vue-ts|svelte-ts|solid-ts|vanilla-ts|…
                    #   create-vite + tinyjs overlay: HMR dev server in the
                    #   native window, esbuild-bundled TS backend (npm pkgs ok)
tinyjs dev          # run with hot reload (frontend edits swap in place;
                    #   backend edits restart the process)
tinyjs build        # dist/<name> binary + dist/<Name>.app (codesigned)
                    #   --dmg installer image; --cli [name] terminal shim
tinyjs publish      # build + dist/publish/<name>-<ver>.zip|tarball + manifest
tinyjs notarize     # macOS: notarytool submit + staple (--dmg re-makes dmg)
tinyjs update       # update tinyjs itself (--check); also: uninstall, version
TINYJS_DEBUG=1 tinyjs dev   # trace every bridge message
```

## Project layout

```
tinyjs.json          { name, title, size, id, version, icon?,
                       minTinyjsVersion?,     // refuse older runtimes with a
                                              // real message — declare the
                                              // newest API family you use
                                              // (sampler → "0.34.0")
                       update?: { url: "https://…/manifest.json", auto? },
                       urlScheme?: "myapp", fileExtensions?: ["md"],
                       openFolders?: true, readAccess?: true | "/path",
                       userAgent?: "…", activation?: "accessory",
                       offscreenRescue?: false, windowPlacement?: true,
                       contextMenu?: false, audioTap?: "app" | "system",
                       debug?: true | "open", browserAccelerators?: true,
                       permissions?: { microphone?: "why", camera?: "why",
                                       speechRecognition?: "why" },
                       chrome?: { frame, windowControls, windowControlsPos,
                                  transparent, vibrancy, squareCorners,
                                  acceptsFirstMouse, menu },
                       signIdentity?, notarize?: { profile },
                       backend?: "backend/main.ts",   // .ts → esbuild bundle
                       frontend?: { build, dist, dev, devUrl },
                       // wrapping a hosted site (recipes.md) — "url" replaces
                       // the local frontend, "api" gates what that origin may
                       // call. NEVER wrap a site you don't control without it.
                       url?: "https://app.example.com",
                       inject?: "src/shim.js",        // document-start, every page
                       downloads?: "auto" | "ask" | "deny",
                       popups?: "external" | "window" | "deny",
                       api?: "wrapper" | { disable?, enable?, origins? },
                       macos?/windows?/linux?: { …merged on top per OS } }
icon.png             1024×1024 app icon
src/main.js          backend
src/frontend/        index.html + assets — served as real files (file://),
                     so relative paths just work
```

## Backend (src/main.js)

```js
export const api = {
  // page calls tiny.api.call('readNotes', { dir }) — return resolves the
  // page's promise, throwing rejects it; meta.window = calling window id
  readNotes: async ({ dir }, app, meta) => { ... },
};
export function init(app) {
  app.push('event-name', data);            // page: tiny.api.on('event-name')
  // app mirrors the page surface: app.window(id).*, app.openWindow,
  // app.tray.*, app.audio.sampler.*, app.clipboard.*, app.store.*,
  // app.paths (plain object), notify, quit, …  — full tour: references/api.md
}
// other exports the scaffold wires: onMenu, onTray, onContextMenu, onHotkey,
// onSystem, onWindowState, onWindowClosed, onOpenUrl, onOpenFiles,
// onMediaKey, onNotificationClick, onNotificationAction, onUpdateAvailable,
// onClipboardChange — each (info, app)
```

Backend: txiki.js (`tjs` global), `tjs.readFile/writeFile/readDir/stat`, `tjs.spawn`, `tjs.watch`, `fetch`, `WebSocket`, `tjs:sqlite`, FFI. NOT Node: no require/Node builtins/native npm modules/JIT. Compute in page (references/performance.md). Streams: `getReader()`, no `for await`. `tjs.cwd`: property. No Intl; format in page. All `tjs.*` fs calls: async, await. `tjs:sqlite`: synchronous, never await; statements only run/all/finalize, no get(); run() returns void.

## Frontend essentials

```js
await tiny.api.call("method", { params }); // -> backend api.<method>
const off = tiny.api.on("event", fn); // <- app.push; returns unsubscribe
audio.src = tiny.fileURL(path); // ALWAYS this, never 'file://' + path
// (breaks on Windows drive letters)
const r = await tiny.fetch(url, opts); // backend-proxied, no CORS/CSP
tiny.win.open("settings", { page: "settings.html", size: "420x300", chrome: { frame: false } });
// chrome/x/y/minSize in open() (or tinyjs.json "chrome" for main) apply
// BEFORE first paint — a late setChrome flashes the default window.
```

Signatures/caveats in references/api.md: windows/chrome/state events, menus (every window), dialogs, tray, notifications, clipboard, hotkeys, audio (sampler/filters/audioTap/proxyURL), store/secrets, permissions, deep links, auto-update, `tiny.macos.*`.

## Cross-platform rules

- Gate features, not OS forks. `capabilities()` lists EXCEPTIONS only: `caps.x !== false`, NEVER `if (caps.x)` (misreports supported OSes). Unsupported queries → `null`; capability calls reject with reason; fire-and-forget → no-op. Exception: `tiny.macos.*` off macOS REJECTS. `caps.sampler`: informational string ('native'|'page'), do not branch.
- Use `app.paths` / `tiny.app.paths()`, never hardcoded `~/Library` / `%APPDATA%`. Join with '/' on all OSes.
- `tiny.system.os()/isMacOS()/isWindows()/isLinux()` are synchronous;
  `architecture()` must be awaited (navigator lies on Apple Silicon).
- Missing system pieces (codecs, speech, tray…) →
  `tiny.system.promptMissing([ids])` puts the fix in front of the user.

## Rules of thumb

- System capabilities: backend `api` methods; thin frontend except COMPUTE. Pass paths, not ArrayBuffers (references/performance.md).
- Escape anything interpolated into `innerHTML` — the page holds an RPC
  channel to full system access.
- No frontend top-level `chrome`: WebView2's non-configurable `window.chrome` makes `const chrome` a script-killing PARSE-time SyntaxError.
- Linux: NEVER Web Audio → `ctx.destination` (measured crackle, no page-side fix). SFX → `tiny.audio.sampler`; EQ → `tiny.audio.filters` (references/platforms.md).
- Occluded/hidden windows throttle (rAF stops). Continuous work: visible window or backend.
- Smoke check: `TINYJS_HTML=<tinyjs-install>/test/smoke.html tinyjs dev`; expect `[web] SMOKE RESULTS {...}`, no FAIL entries, clean exit.
- `dist/<Name>.app` is the distributable; bare `dist/<name>` is local-only.
