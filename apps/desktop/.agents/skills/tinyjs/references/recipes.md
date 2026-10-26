# Recipes — shipped app patterns and observed pitfalls

## Tray / menu-bar app

```jsonc
// tinyjs.json
{ "activation": "accessory" } // launches with no Dock icon, window hidden — no flash
```

```js
export function init(app) {
  app.tray.set({
    title: "◎",
    menu: [{ id: "show", label: "Open" }, { separator: true }, { id: "quit", label: "Quit" }],
  });
  app.window("main").setHideOnClose(true);
}
export function onTray(id, app) {
  if (id === "show") app.window("main").show();
  if (id === "quit") app.quit();
}
```

- `tray.position()`: dropdown anchor below icon; Linux null (AppIndicator hides geometry), center instead.
- Asset-free icons: macOS `'sf:<symbol>'`; Windows `'emoji:<glyph>'` (mono silhouette). Branch by OS.
- win/linux `setHideOnClose` requires a way to reopen app; tray qualifies.
- `primaryAction: true` = left-click fires `onClick`, menu on right-click.

## Desktop pet / overlay / HUD

coo3d/kraa3d: one ~25fps backend tick drives many frameless/transparent windows via `app.window(id).*`.

- **Pass `chrome`, `x`, `y` IN `win.open`**: applied before first paint. Boot-time `setChrome` is late: white default window flashes before transparent/frameless pet.
- `setClickThrough(true)`: never trap mouse. `setLevel('desktop')`: behind everything (wallpaper pets); `'overlay'`: above fullscreen. `show({ activate: false })`: HUD without focus theft.
- Occluded/hidden windows THROTTLED (rAF stops). Simulate in unthrottled backend; push tick state; windows only render.
- Pool via hide/move/reuse, not create/destroy loops (ninth poop splat reuses oldest window invisibly).
- Pseudo-depth: re-`show()` windows back-to-front as sprites cross.
- Linux frameless windows have WM resize grips; declare satellite `minSize` to keep content in view.
- `data-tiny-drag` on a header = native window drag; `acceptsFirstMouse:
true` lets the focusing click also reach the page (palettes).

## Media / audio app

Audio routing varies most by platform:

- need: play music / long streams; use: `<audio>` element (streams from disk/net; never decode whole songs)
- need: game/UI sound effects, pitch/pan per shot; use: `tiny.audio.sampler` (native mixer on Linux, Web Audio host elsewhere — same API)
- need: EQ / DSP on the app's whole output; use: `tiny.audio.filters` (native: Linux + macOS 14.2+); Windows: `capabilities().audioFilters === false` → `tiny.audio.pageChain(ctx)`
- need: VU meter / visualizer of what's playing; use: `tiny.audioTap` (PCM chunks at meter rate; post-filter where a chain is active)
- need: cross-origin stream INTO Web Audio; use: `audio.crossOrigin='anonymous'; audio.src = tiny.proxyURL(url)` (macOS)

- **Linux: NEVER Web Audio graph → `ctx.destination`**. WebKitGTK normal-priority rendering crackles even idle, any latencyHint. Elements play directly; SFX → sampler; EQ → native filters. NEVER Linux `pageChain`.
- Linux graph-routed elements ALSO play natively (WebKitGTK double-play). If routing necessary, set element volume 0.
- WebKitGTK: no native HLS (vendor hls.js); codecs depend on installed GStreamer plugins. `tiny.system.requirements(['codecs'])` prompts installation.
- `MediaElementSource`: Chromium post-volume, WebKit pre-volume. Do not mix with element volume when analyzing tap.

## Document app

```jsonc
{ "fileExtensions": ["md", "txt"], "openFolders": true, "readAccess": true }
```

- `onOpenFiles(paths, app)` receives double-click, icon drop, `open -a`, argv (`myapp notes.md`), and second-launch forwarding to running instance. Cold-start buffered.
- `readAccess` expands `file://` media/img scope (default: frontend dir only). ALWAYS `tiny.fileURL(path)`, never `'file://' + path` (Windows drive letters break).
- `tiny.win.onDrop` gives real paths for files dropped onto the window;
  `startDrag({ files })` drags them out (call during mousedown).
- `app.setAsDefaultHandler(ext)` only on user request, NEVER first run or uninvited competition with their editor.
- Multi-document: `win.open` per doc; `api` handler `meta.window` identifies caller. `win.print()`/`printToPDF` target calling window.

## Wrapping a hosted web app

```jsonc
{
  "url": "https://app.example.com", // the main window IS the site
  "userAgent": "Mozilla/5.0 … Version/17.4 Safari/605.1.15",
  "api": {
    "origins": {
      // ← do not skip this, see below
      "https://app.example.com": ["notify", "store.*", "win.*", "app.badge"],
      "file://*": "all", // your own bootstrap pages, if any
    },
  },
  "downloads": "auto", // auto | ask | deny
  "popups": "external", // external | window | deny
  "inject": "src/shim.js",
} // optional document-start shim
```

**Use `"url"`, NOT `frontend.devUrl`**: devUrl is dev-only; packaged app otherwise has no page. `"url"` needs no local frontend.

**Gate origins.** `tiny` injects into EVERY origin; without `"api"`, site JS gets full filesystem/process RPC, worse than Electron. Backend enforces `"api"`; hostile page can edit page-side objects, so page gating cannot protect. Shapes: `"api": "wrapper"` (sane preset), `{ "disable": ["*"], "enable": [...] }` (**enable wins**), or per-origin mapping above. Origin is ENGINE-attested calling-frame origin, not page-claimed. With `origins`, unmatched origins get nothing, including redirects to unlisted domains. Denials reject with readable reason; `capabilities().api.denied` supports hiding unusable UI.

What a wrapped site gets that a local-page app never needed:

- `alert`/`confirm`/`prompt` → native panels headlined by the page's origin.
- Downloads: `<a download>`, blobs, and un-renderable MIME types. `auto`
  writes to the OS Downloads dir with de-duplicated names.
- `window.open` / `target=_blank` per `"popups"`; `window` mode keeps
  `window.opener` and the return value alive (OAuth popups check them).
- Navigation events/veto: api.md `onNavigate`, `kind: 'policy'`; return `'deny'` or `'external'` (real browser). Keep app URLs in-window; send marketing/support/OAuth-provider links out.
- `tiny.win.find(term)` for ⌘F.

Other notes:

- Default UA lacks `Version/x Safari/x`: UA-sniffing sites reject; set real UA. Some SaaS detects/refuses embedded webviews regardless; no workaround.
- Cookies/logins persist in the webview's default store per app id.
- Read platforms.md before promising behavior: Linux denial occurs after request; Windows asked POST reissues as GET.

## Windowless / agent app

`{ "activation": "accessory" }`: main window always EXISTS, can hide but never close. Hosts required page work (mac/win sampler Web Audio). Backend works; `tiny.win.show()` only when needed. Hidden windows cost ~nothing: no compositing/GPU; visibility does not affect audio render threads.

## Self-driving test page (headless-ish verification)

From any app dir, `TINYJS_HTML=/abs/path/page.html tinyjs dev` opens test page. Poll ~100ms for `tiny`, drive API, write `tiny.store.set('results', {...})`; read app-id store.json in platform data dir (`~/Library/Application Support/<id>/` macOS, `~/.local/share/<id>/` Linux). Reload-survival test: store phase marker, `location.reload()`, branch on marker at boot.
