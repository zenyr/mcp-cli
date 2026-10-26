# Coming from Electron

tinyjs: ~6 MB vs Electron ~200 MB, instant startup, OS webview/native menus/dialogs. Backend is NOT Node; renderer is NOT pinned Chromium. Port architecture, not code.

## The two mindset shifts (read these first)

1. **Backend: txiki.js/QuickJS, NOT Node.** Never `require`, Node builtins (`fs`, `path`, `crypto`, `child_process`…), native npm modules, or node-gyp. Runtime: `tjs.*` (readFile/writeFile/readDir/stat/spawn/watch/listen/connect), standard `fetch`/`WebSocket`, `tjs:sqlite`, C-library FFI. Pure-JS npm: `backend: "backend/main.ts"`, bundled by esbuild. Node builtin imports fail at bundle/runtime. QuickJS has no JIT; compute in page (references/performance.md).
2. **Renderer: OS webview** — WKWebView/macOS, WebView2/Chromium/Windows, WebKitGTK/Linux. No bundled/chosen browser: feature-detect. Linux codecs may need GStreamer plugins; WebKitGTK lacks native HLS (vendor hls.js) and WebGPU. Safari CSS/JS feature gates apply to two platforms.

## API mapping

- Electron: `new BrowserWindow(opts)`; tinyjs: `tinyjs.json` (main window) / `tiny.win.open(id, { page, size, chrome, x, y })` — chrome/x/y in `open()` apply before first paint
- Electron: `ipcMain.handle` + `ipcRenderer.invoke`; tinyjs: `export const api = { method: async (params, app) => … }` + `tiny.api.call('method', params)`
- Electron: `webContents.send` → renderer listener; tinyjs: `app.push('event', data)` + `tiny.api.on('event', fn)`
- Electron: preload script / `contextBridge`; tinyjs: not needed — `tiny` is injected into every page automatically
- Electron: `Tray`; tinyjs: `tiny.tray.set({ title, icon, menu })` (`'sf:<name>'` icons on macOS, `'emoji:<glyph>'` on Windows)
- Electron: `Menu.setApplicationMenu`; tinyjs: `tiny.menu.set(spec)` — shows in EVERY window on all three OSes; `tiny.win.menu.*` for per-window
- Electron: `globalShortcut`; tinyjs: `tiny.hotkey.register(id, 'cmd+shift+k')` (`cmd` = Ctrl on win/linux)
- Electron: `dialog.showOpenDialog` etc.; tinyjs: `tiny.dialog.openFile/openFiles/pickFolder/saveFile/alert/confirm/prompt`
- Electron: `shell.openExternal/showItemInFolder/trashItem`; tinyjs: `tiny.app.shell.open/reveal/trash`
- Electron: `app.getPath(name)`; tinyjs: `tiny.app.paths()` / backend `app.paths` (plain object)
- Electron: `safeStorage` / keytar; tinyjs: `tiny.app.secrets.get/set/delete` (Keychain / Credential Manager / Secret Service)
- Electron: `autoUpdater` (+ electron-updater); tinyjs: `"update": { url, auto }` in tinyjs.json + `tinyjs publish`; `update.check()` / `update.install()`
- Electron: `nativeTheme`; tinyjs: `tiny.theme.get()/on()`
- Electron: `screen.getAllDisplays`; tinyjs: `tiny.app.screens()`
- Electron: `clipboard`; tinyjs: `tiny.clipboard.read/write/watch` (richer: sourceApp, concealed marker, files)
- Electron: `new Notification`; tinyjs: `tiny.notify(title, body, { actions })`
- Electron: `powerSaveBlocker`; tinyjs: `tiny.app.power.preventSleep(reason)` (auto-released on exit)
- Electron: `app.setLoginItemSettings`; tinyjs: `tiny.app.launchAtLogin.set(v)`
- Electron: `app.setBadgeCount`; tinyjs: `tiny.app.badge('3')`
- Electron: `app.requestSingleInstanceLock`; tinyjs: automatic — second launch forwards its argv/deep-link to the running copy
- Electron: `app.setAsDefaultProtocolClient`; tinyjs: `"urlScheme"` in tinyjs.json + `onOpenUrl`
- Electron: file associations (builder config); tinyjs: `"fileExtensions"` + `onOpenFiles`; `"openFolders": true`
- Electron: `webContents.executeJavaScript`; tinyjs: backend `app.window(id).eval(js)`
- Electron: `webContents.printToPDF`; tinyjs: `tiny.win.printToPDF(path)` (routes to the calling window)
- Electron: `desktopCapturer`; tinyjs: `tiny.app.captureScreen(screenId)` / `tiny.macos.recorder` (macOS)
- Electron: `BrowserWindow` flags: frame, transparent, alwaysOnTop, ignoreMouseEvents; tinyjs: `chrome: { frame, transparent }`, `setAlwaysOnTop`, `setClickThrough`, `setLevel('desktop'|'floating'|'overlay')`
- Electron: `session.webRequest` / CORS dances; tinyjs: `tiny.fetch(url, opts)` — backend-proxied, no CORS/CSP; `{ stream: true }` for endless bodies; `tiny.proxyURL(url)` to get cross-origin streams into Web Audio untainted

## No equivalent — design around

- **Renderer `nodeIntegration`**: never. No page system access; privileged ops cross `tiny.api`. Escape all `innerHTML` interpolations: page holds full-system-access RPC.
- **`BrowserView` / `<webview>`**: none; use same-origin/friendly iframe or second window.
- **Chromium devtools protocol, `webContents` surgery, custom protocol handlers, service-worker interception**: none. Fetch-shaped cases: `tiny.fetch`/`proxyURL`.
- **Buffers over IPC**: the bridge is text. Pass file paths (see
  references/performance.md).
- **Per-window process control, `process.memoryUsage()` of renderers**: the
  webview owns its processes.
- **Backend Node crypto**: use txiki WebCrypto (`crypto.subtle`); available in page too.
- **Windows thumbar buttons/jump lists**: not yet. Taskbar basics: `app.progress()` / `app.badge()`.

## Porting order that works

1. Map `main.js` IPC handlers 1:1 to `export const api = {}`; `fs`/`path` → `tjs.*`, join with '/' on all OSes; `app.getPath` → `app.paths`.
2. Reuse renderer build: `"frontend": { build, dist, dev, devUrl }` runs Vite/webpack dev server in native window with HMR.
3. `ipcRenderer.invoke` → `tiny.api.call`; 5-line wrapper preserves call sites. Remove preload.
4. Main window: tinyjs.json. Satellites: `win.open(...)`, chrome in open call.
5. Feature-detect Chromium-specific renderer features; test WebKit early. Common surprises: UA-sniffing sites and `Version/x Safari/x` (`"userAgent"` in tinyjs.json for wrappers).
6. Wire `"update"` + `tinyjs publish` and delete your updater code.
