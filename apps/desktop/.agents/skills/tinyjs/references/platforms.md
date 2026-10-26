# Platforms

Primary: macOS. Beta: Windows/Linux. All share project, tinyjs.json, `tiny.*` API, and commands.

### app users need

- macOS: macOS 14+ (universal: Apple Silicon + Intel)
- Windows: Windows 10/11 with the WebView2 runtime (preinstalled on 11)
- Linux: glibc 2.35+: Ubuntu 22.04 / Debian 12 / Mint 21 and newer, `webkit2gtk-4.1`, X11 or Wayland

### webview

- macOS: WKWebView
- Windows: WebView2 (Chromium)
- Linux: WebKitGTK 4.1

### `tinyjs build` output

- macOS: `dist/<Name>.app` (codesigned) + bare `dist/<name>`
- Windows: portable `dist/`: `<name>.exe` + `launcher.exe` + `frontend/`
- Linux: portable `dist/`: backend binary + `launcher` + `icon.png`; per-arch tarballs from `publish`

### publish / auto-update

- macOS: zip + dmg, notarized
- Windows: `-win.zip`; https+sha256 trust
- Linux: `-linux-<arch>.tar.gz` × {x86_64, arm64}; `.desktop` self-registers on first run

### toolchain to develop tinyjs ITSELF

- macOS: Xcode CLT, `./setup.sh`
- Windows: MinGW-w64 g++ (`winget install BrechtSanders.WinLibs.POSIX.UCRT`), `setup.ps1`, `tinyjs.cmd`
- Linux: `apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libpipewire-0.3-dev`, same `./setup.sh`

All three: bridge (api calls, push events, `tiny.fetch` streaming), dev/hot-reload, Vite `devUrl`, multi-window/per-window bridge, every-window menu bars/per-window menus/accelerators (⌘ → Ctrl off macOS), native dialogs, custom context menus, clipboard read/write/watch, global hotkeys, `shell.open/reveal/trash`, `secrets`, `store`, `power.preventSleep`, theme/sleep/wake events, `screens`, `printToPDF`, window ops (levels, clickThrough, frameless/transparent chrome, `data-tiny-drag`, `onState`, `ensureOnScreen`, `minSize`, zoom), `win.onDrop`/`startDrag`, deep links/file associations/argv/single instance, auto-update, sqlite, `notify`, `tiny.audio.sampler` (Linux native mixer, elsewhere page host; identical API), `say`/`voices`, `launchAtLogin` (win/linux built apps), `captureScreen` (Linux X11).

## The capability honesty system

`tiny.system.capabilities()`: EXCEPTIONS only; test `caps.x !== false`, NEVER `if (caps.x)`. Unsupported: fire-and-forget no-op, queries → `null`, capability calls reject with reason; nothing hangs. `tiny.macos.*` off macOS REJECTS, never null. `tiny.system.requirements`/`missing`/`promptMissing` offer actionable installation prompts for codecs, speech, tray, mouseTracking.

## Windows notes

- Real-path drag/drop both ways; tray; `notify` balloons (no actions/replies); `frontmostApp`; `app.badge`/`app.progress`/full app surface; `authenticate` = Windows Hello (false if unenrolled); `audioTap` = WASAPI loopback ('system').
- `capabilities().audioFilters` FALSE permanently, measured: only silencing lever is persisted mixer state shared by all machine WebView2 apps. Supported fallback: `tiny.audio.pageChain(ctx)`.
- Declare transparent MAIN window in tinyjs.json `"chrome"`, not late `setChrome`. Transparency excludes Win32 menu bars; frameless/transparent windows never draw one.
- No `pickColor` (works on mac + linux), no `spotlight` backend, no
  `nowPlaying`/media keys.
- WebView2 = Chromium: `MediaElementSource` taps post-volume (WebKit: pre).
- Wrappers: `NavigationStarting` lacks deferral; policy ask cancels/re-navigates. ASKED main-frame POST → GET (forms only; fetch/XHR bypass policy). Same reason: back/forward not asked. Popup `window.close()` no-ops; close by window id from backend.

## Linux notes

- X11-only: `mousePosition` (Wayland hides global pointer; `"windowPlacement": true` forces XWayland, or use `tiny.app.mouseTracking` portal), `keystroke`/`paste` (XTest), `captureScreen`, `app.icon`/`app.attention`/`app.presence` (no GTK3 Wayland destination). Trust session-specific `capabilities()`, not desktop name.
- `app.badge`/`app.progress`: Unity LauncherEntry DBus, BUILT apps only (signal targets `.desktop` entry); supported docks: KDE Plasma, Ubuntu Dock, Dash-to-Dock, not vanilla GNOME Shell.
- Tray is AppIndicator/StatusNotifier — menu-based; bare icon click emulated
  via a synthetic entry; `tray.position()` → null.
- `notify` DOES support action buttons (freedesktop), no reply fields.
- `pickColor` (portal), `spotlight` (`plocate`/`locate`/bounded `find`),
  `nowPlaying`/media keys (MPRIS: media widget + lock screen) all work.
- `idleTime` needs GNOME. `authenticate` always false (no identity check
  exists — gates fail closed). `thumbnail` images-only.
- getUserMedia requires manifest `"permissions"`: no OS prompt, undeclared → NotAllowedError. MediaRecorder: video/mp4, webkit 2.52+.
- **NEVER Web Audio → `ctx.destination`**: measured WebKitGTK crackle, no graph-side fix. Elements play directly; SFX → native `tiny.audio.sampler`; EQ → native `tiny.audio.filters`, never `pageChain`. Graph-routed elements ALSO play natively (double-play); set element volume 0 if routing is necessary.
- No native HLS (vendor hls.js), no WebGPU, codecs depend on GStreamer
  plugins (`requirements(['media.aac', …])` prompts the install).
- Frameless windows get WM resize grips — declare `minSize` on satellites.
- Deep links / file associations / single instance work via the
  self-registered `.desktop` entry (first run of a built app).
- Wrappers: policy ask at RESPONSE decision (only WebKitGTK main-frame distinction point). DENIED navigation already sent its request: hides page, cannot block request. Only engine with real find match counts. Origin stamping is frame-blind: shim injects top-frame only, ordinary calls main-frame; subframe hand-written postMessage attributed to top frame. `"api"` origins alone cannot protect wrappers embedding untrusted iframes.

## Not supported (feature-detect; they fail cleanly)

- **Windows**: `proxyURL`, `recorder`, `pickColor`, `nowPlaying`/media keys,
  `share`, `setAllSpaces`, `wifi`, `spotlight`, `system.locale`,
  notification actions, `tiny.macos.*` (rejects).
- **Linux**: `recorder`, `ocr`, `share`, `wifi`, `selectedText`/
  `otherWindows`/`moveWindow`/`frontmostApp`, `authenticate` (false),
  `system.locale`, `setAllSpaces` (maps to sticky windows), `tiny.macos.*`
  (rejects).
- **macOS**: all features; reference platform. `capabilities().ai` requires launcher BUILD against FoundationModels + macOS 26 + Apple Intelligence ON.

Plans and burn-downs: tarwin/tinyjsapp TODO-windows.md, TODO-linux.md.
