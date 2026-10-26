# Fish Audio speech production guide

Run from the repository without changing global links.

```bash
bun bin/fish-audio.ts tts 'Hello' --voice <voice-id> -o hello.wav --yes
printf 'First sentence.\nSecond sentence.\n' | bun bin/fish-audio.ts tts - -o hello.mp3 --yes
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --estimate
bun bin/fish-audio.ts script --file story.txt -o story.mp3 --max-credits 10000 --concurrency 2 --yes
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.txt --speakers
bun bin/fish-audio.ts stt --file meeting.m4a -o meeting.json --json
bun bin/fish-audio.ts roundtrip 'Pronunciation check sentence' --audio hello.wav --max-cer 0.1
bun bin/fish-audio.ts roundtrip 'Pronunciation check sentence' -o check.mp3 --yes --max-cer 0.1
```

`bun run cli fish-audio ...` runs the same implementation.
`tts` and `stt` provide convenient input forms for speech generation and transcription.
`script` handles generation and merging. `roundtrip` generates audio, transcribes it, and compares normalized character error rate (CER).
`--fail-over` is an alias for `--max-cer`. Exceeding the CER threshold returns exit code 1.

`--file` and positional input are mutually exclusive.
`tts -` reads text from standard input, preserving internal line breaks. `stt -` reads a URL, not audio bytes.
Specify local audio with `@path` or `--file`. The runner reads and hashes files before uploading.
The server controls transcription defaults. `--text` writes transcript text to standard output, and `--speakers` includes speaker labels.
`--json` preserves the wrapped JSON result. TXT and JSON exports are supported.
SRT and VTT are rejected because the service does not return timestamps.

`--estimate` and `--dry-run` do not generate audio.
They may require a connection and authentication to retrieve account byte limits and balances.
`help`, `methods`, `skill`, and `--skill` do not connect to the server.
Select a voice with `voice search --self` or `voice search --language ko`.
`skill` does not embed real voice IDs.

See the [common usage guide](../../apps/cli/README.md) and [plugin development guide](../README.md).

## Budgets and recovery

Scripts split at paragraphs, sentences, clauses, and whitespace while preserving grapheme and inline-tag boundaries.
Each request respects both the 2,000-character limit and the account's UTF-8 byte limit.
The first response fixes the voice for subsequent chunks. Generation stops if voice information is missing.
Concurrency ranges from 1 to 4.

Planning reserves 2 credits per UTF-8 byte of uncached text.
The same reservation applies to double-rate voices and single chunks.
Each worker reserves credits before its request, then replaces the reservation with the reported charge.
This is a local estimate. It does not enforce a server-side spending cap.
`--max-credits` covers speech generation only, excluding additional transcription costs from roundtrip verification.
Service price changes may cause charges to exceed the estimate.
Noninteractive generation requires `--yes`. Interactive generation requests confirmation.

Identical login, text, and generation options reuse `$XDG_CACHE_HOME/mcp-cli/fish-audio/`.
The default path is `~/.cache/mcp-cli/fish-audio/`. Responses and audio files are reused even when the output path changes.
Authentication identifiers partition the cache. Tokens are not stored in the cache.
OAuth refresh preserves the partition. A new login creates a new partition.

- `pending`: the call started, but its response was not durably saved. Automatic retries remain blocked after the normal duplicate-call window expires.
- `generated`: the response was durably saved. Downloads or file exports can resume without another paid call.
- `ready`: the audio file was durably saved. Conversion and merging reuse it. If missing, the saved response is used.
- `failed`: the server returned `isError`, or the runner confirmed that request transmission never started. Explicit server errors retry once under the same execution policy. Pre-transmission failures return to the caller and can be retried.

Completed files are retained. `--keep-parts` remains accepted for backward compatibility, but chunks are always retained.
Generation options are included in cache keys. Transcription records also include the local file hash and model, allowing recovery after file-write failures.
HTTPS URLs identify remote input. If the content changes, explicitly use another URL or a new output cache.

All remote calls, including upload-location requests, use the existing duplicate-call guard.
`--allow-repeat` does not erase job records.
Do not delete `pending` records to bypass duplicate protection. Check the service result before making another paid request.

Cache-level and per-output locks reject concurrent processes using the same login or destination.
Script workers within one job may run in parallel.
SIGINT and SIGTERM stop new work and close the connection after active requests finish. A second signal exits immediately.
Forced termination may leave cache locks and `<output>.parts/.lock/owner.json`. Errors report the lock path.
Before manually removing a lock, confirm that its owner process has exited and resolve uncertain request outcomes.
Corrupt records block execution. Files are saved through temporary writes, fsync, and rename.
Download or ffmpeg failures preserve the existing destination file.

The output extension selects MP3, WAV, OGG, FLAC, M4A, AAC, or WebM.
The connection implementation inspects audio bytes and invokes ffmpeg when conversion or merging is necessary.
Install ffmpeg before generating multiple chunks.
Expired saved URLs do not automatically trigger another paid generation.

## Files and media status

Use group help to select commands. `--help` shows concise usage, and `--help=full` shows nested input roles and the complete server specification.
Select a workspace with `account workspaces` before running these commands.

```bash
fish-audio asset collection list --workspace-id <workspace-id> --all
fish-audio asset list --workspace-id <workspace-id> --collection-id <collection-id>
fish-audio asset list --workspace-id <workspace-id> --search portrait --kinds '["image"]'
fish-audio asset get --workspace-id <workspace-id> --asset-id <asset-id>
```

Collections contain folders, avatars, and styles. `asset list` returns files.
To continue listing files, keep the same filters and pass the previous `next_cursor` as `--cursor`.
`asset get` returns the original `object_key` and a temporary download URL.
For compatible generation inputs, use the original object key instead of the thumbnail URL.

`asset save` saves a completed upload (`--object-key`) or successful generation (`--source-task-id`).
Saving again returns the existing location. Use `asset update` to move or rename an asset.
Omitting `collection_id` keeps the location. Pass JSON null to move an asset to the top level.

```bash
fish-audio asset update --input '{"workspace_id":"<workspace-id>","asset_id":"<asset-id>","collection_id":null}'
```

`--collection-id null` sends the string `"null"`. Use `--input` for an actual null.
`asset folder create` creates a folder. `asset avatar create` creates an avatar from one prepared image.
Select one avatar input: `object_key`, `source_task_id`, or `portrait_asset_id`.
`default_voice_id` is optional.
Creation commands require a UUID `request_id`. Recover lost responses with the same input and ID.
Moving a saved portrait into an avatar requires explicit approval with `--move-existing`.
Creating an avatar does not generate media.
To replace its portrait later, move the image into the collection with `asset update`, then run `asset collection update`.
Collection commands do not support deleting collections or creating styles.

Before estimating generation, select model input roles and capabilities with `media model get`.
The `inputs` array accepts `{ "role": "...", "object_key": "..." }` entries.
`--input-object-key` is shorthand for one input. Video generation also selects a capability with `--operation`.
Estimate the cost first, then submit the same generation input with the returned pricing values.

```bash
fish-audio media job status --generation-id <generation-id>
fish-audio media job status --generation-ids '["<generation-id-1>","<generation-id-2>"]'
```

Specify one ID or up to 20 IDs.
Status queries can reconcile provider processing status and credits. Query again after the returned `poll_after_seconds`.
Keep only active IDs in subsequent batches.
Completed responses include results, so a separate `media job result` call is unnecessary.

## Migrating from the standalone CLI

Keep the existing standalone repository and global PATH.
Try commands with `bun bin/fish-audio.ts` or `bun run cli fish-audio`.
Use existing `mcp-cli login fish-audio` authentication if needed. Do not copy credential files from the standalone project.

`speech create`, `transcription create`, and `call <tool>` retain their schemas, flags, MCP JSON output, and exit codes.
Use `tts` or `stt` for positional speech input.
The standalone CLI's `auth login`, `tools`, `schema`, and `parity` are not mcp-cli commands.
Use `mcp-cli login fish-audio`, `methods`, command help, and the existing generation workflow instead.

Tests use fake tool connections and local audio data. Conversion is also verified when ffmpeg is available.
This integration has not verified real remote audio quality, current billing, or parity with the complete remote schema.
