# Execution placement and wire costs

Incorrect page/backend placement causes sluggishness that tuning cannot fix.

## The engines are not equal

- **Page**: OS webview, JavaScriptCore (macOS/Linux), V8/Chromium (Windows). JIT, compiled near-native WebAssembly, Web Workers, WebGL, OffscreenCanvas, SIMD. WebGPU: WebView2 yes, recent macOS WKWebView yes, WebKitGTK no.
- **Backend**: txiki.js/QuickJS interpreter, no JIT or usable WASM. A 50ms page numeric loop can take >1 second. FFI C calls run at C speed; surrounding JS stays interpreted.

**Page computes; backend accesses system.** Page: large JSON parsing, text diffs, canvas image manipulation, layout math, audio analysis, WASM codecs. Backend: files, sockets, processes, sqlite, FFI, watching, spawning, OS APIs. Mixed jobs (directory indexing): backend reads, page computes. Keep computation backend-side ONLY when I/O-bound: C-fast `tjs:sqlite` queries beat sending rows to the page for filtering.

## The wire is text — keep bytes off it

Socket wire: newline-delimited text. Binary requires base64: +33% size, encode/decode, full copy at each end, all on both main threads.

- **Pass paths, not bytes.** Backend writes file, returns path; page uses `tiny.fileURL(path)` for media/src and `readAccess` outside frontend dir. Runtime follows this: `tiny.audio.sampler.load(name, path)` never streams sound over the wire; byte inputs spill once to app cache, then load from disk.
- **Batch.** One `api.call` returning 500 rows beats 500 calls. `app.push` is cheap, not free: coalesce frame state into one message/tick (coo3d: 20+ windows, 25fps backend tick, one message/window/tick).
- **Never stream media over bridge.** Audio/video-rate base64 PCM/frames burn CPU on both sides. Only sanctioned exception: `tiny.audioTap` at meter rate (~80ms VU/viz chunks), never faster.
- Shared large state: sqlite (backend queries, page renders) or a file read once by page; never repeatedly push giant objects.

## Webview throttling — hidden windows do less

WebKit occluded/hidden windows: rAF stops, timers stretch. Hidden windows cannot drive visible windows, game loops, or timekeeping. Continuous work: visible window or backend (timers never throttled). Exception: hidden main-window sampler/Web-Audio host renders because audible pages are exempt; own timers are not.

## Memory shape

- Each window is a real webview: cheap to hide, expensive to churn. Pool/reuse (show/move/hide), not create/destroy loops; coo3d recycles splat windows.
- Decoded 48kHz stereo float: ~375KB/second. Use `tiny.audio.sampler` for short SFX banks; music via disk-streaming `<audio>`.
- Keep backend memory small: stream large files with `getReader()`, never buffer them whole.

## Quick table

- job: tight numeric loop, parser, differ; where: page; why: JIT
- job: WASM (codecs, sqlite-wasm, etc.); where: page; why: real compiled WASM
- job: audio DSP/mixing; where: `tiny.audio.sampler` / `tiny.audio`; why: native/RT-scheduled paths exist; page Web Audio crackles on Linux
- job: file I/O, watching, spawn; where: backend; why: that's what it's for
- job: sqlite queries; where: backend (`tjs:sqlite`); why: C-speed, no rows over the wire
- job: per-frame animation state; where: visible page (rAF) or backend tick; why: hidden pages are throttled
- job: calling a C library; where: backend FFI; why: the call is native; keep the JS loop around it thin
- job: big blob page→backend or back; where: write a file, pass the path; why: wire is base64 text
