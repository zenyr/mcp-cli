# Fish Audio voice workflows

Run from this checkout without changing global links:

```bash
bun bin/fish-audio.ts tts '안녕하세요' --voice <voice-id> -o hello.wav --yes
printf '첫 문장.\n둘째 문장.\n' | bun bin/fish-audio.ts tts - -o hello.mp3 --yes
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --estimate
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --max-credits 10000 --concurrency 2 --yes
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.txt --speakers
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.json --json
bun bin/fish-audio.ts roundtrip '발음 확인 문장' --audio hello.wav --max-cer 0.1
bun bin/fish-audio.ts roundtrip '발음 확인 문장' -o check.mp3 --yes --max-cer 0.1
```

`bun run cli fish-audio ...` reaches the same implementation. `tts` and `stt` provide convenience inputs for the underlying speech tools. `script` orchestrates generation and merging. `roundtrip` orchestrates speech generation, transcription and normalized character error rate (CER) comparison. `--fail-over` aliases `--max-cer`. A failed CER threshold exits with status 1.

`--file` and a positional input are mutually exclusive. `tts -` reads text and preserves its internal line breaks. `stt -` reads a URL, not audio bytes. Local audio requires `@path` or `--file`; the existing runtime reads and hashes the file before upload. STT defaults remain server-controlled. `--text` renders transcript text on stdout, `--speakers` includes speaker labels, and `--json` keeps a result envelope. TXT and JSON exports are supported. SRT/VTT are rejected because the service does not return timestamps.

`--estimate` and `--dry-run` do not generate speech. A speech plan reads the account's byte limit and balance, so these options may connect and require authentication. `help`, `methods`, `skill`, and `--skill` remain offline. Run `voice search --self` or `voice search --language ko` to select a voice. No live voice IDs are embedded in `skill`.

## Budget and resume

Speech splits at paragraphs, sentences, clauses and whitespace, with grapheme and inline tag boundaries preserved. Each request respects both 2,000 characters and the account's UTF-8 byte allowance. The first response pins the voice for later chunks. Missing voice information stops further generation. Concurrency is limited to 1–4.

The plan reserves two credits per UTF-8 byte for uncached text. The reservation covers voices with double rates and applies to a single chunk too. Each worker reserves credits before dispatch. Reported charges replace that reservation. This is a conservative local estimate, not a server-enforced billing cap. `--max-credits` covers TTS generation, not the additional STT cost of roundtrip. A changed service price can exceed the estimate. Noninteractive generation requires `--yes`; interactive generation prompts for confirmation.

The same login, text and generation options reuse `$XDG_CACHE_HOME/mcp-cli/fish-audio/` (default `~/.cache/mcp-cli/fish-audio/`). Different output paths reuse these responses and audio artifacts. Authentication identities partition the cache without storing tokens there. An OAuth refresh preserves its partition; a new login starts a new partition.

- `pending`: a call started without a durable response. Automatic retry is blocked even after the normal repeat window expires.
- `generated`: the response is durable. Resume retries download or file export, without repeating the paid call.
- `ready`: audio is durable. Resume reuses it for conversion or merging. A missing audio file falls back to its saved response.
- `failed`: the server returned `isError`, or the runtime proved that dispatch never started. TTS permits one retry for explicit server errors through the same runtime policy. A pre-dispatch failure is returned to the caller and remains retryable.

Completed artifacts remain available. `--keep-parts` is accepted for migration, and parts are always retained. Generation options participate in the cache key. STT journals also include a local file's content hash and model, so failed transcript writes can resume safely. An HTTPS URL identifies remote input; if its contents change, use a different URL or a new output cache deliberately.

The existing repeat guard still applies to every remote call, including upload-slot requests. `--allow-repeat` does not discard workflow journals. Do not remove a pending journal simply to bypass duplicate protection. Inspect the service result before deciding to issue another paid request.

A cache-scope lock and per-output lock reject concurrent workflow processes for the same login or destination. Script workers still run concurrently inside one workflow. SIGINT/SIGTERM stop new work and drain active requests before closing the connection. A second signal exits immediately. A hard crash or second signal can leave a cache lock and `<output>.parts/.lock/owner.json`; the error identifies the lock path. Verify that the owner process has ended and reconcile pending requests before manually removing those locks. Corrupt journals fail closed. File writes use temporary files, fsync and rename. Download or ffmpeg failures preserve an existing destination.

Audio output extensions select MP3, WAV, OGG, FLAC, M4A, AAC or WebM. The adapter inspects audio bytes and invokes ffmpeg when conversion or merging is needed. Install ffmpeg before multi-part generation. Saved URLs can expire; an expired response does not trigger automatic paid regeneration.

## Migration

Keep the standalone checkout and existing global PATH unchanged. Test the commands through `bun bin/fish-audio.ts` or `bun run cli fish-audio`. Use the existing `mcp-cli login fish-audio` login when needed. Do not copy credential files from the standalone project.

`speech create`, `transcription create` and `call <tool>` retain their original schemas, flags, MCP JSON output and exit statuses. They do not gain positional speech inputs; use `tts` or `stt` for those. Standalone `auth login`, `tools`, `schema`, and `parity` are not new mcp-cli commands. Use `mcp-cli login fish-audio`, `methods`, command help and the existing generation workflow instead.

Tests use fake tool ports and local audio fixtures. They verify conversion with ffmpeg when available. Live remote voice quality, current billing and full remote schema parity have not been verified by this integration.
