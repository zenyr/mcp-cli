# Fish Audio workflow integration

Simple aliases (`tts`, `stt`) and local workflows (`script`, `roundtrip`) are separate from generated MCP tools. Extensions declare schemas and discovery metadata. Raw `call`, `speech create`, and `transcription create` retain their current interfaces.

The runtime owns a lazy shared session and a guarded tool executor. Every extension call passes schema validation, service policy, local upload preparation, and repeat protection. Upload slot calls use the same executor. The CLI application retains OAuth and credential ownership.

Fish domain and application modules depend on small ports. Fish adapters own stdin, files, atomic journals, HTTP audio downloads, and ffmpeg. Shared core owns only command extension contracts.

Paid generation uses durable pending/generated/ready states. Unknown outcomes never retry automatically. Generated responses survive download or merge failures. Full generation input identifies cached work. Completed artifacts remain available for resume. Workers reserve conservative credits before starting and drain active calls before session close.

File ownership during implementation: root owns core/runtime, plugin registration, and documentation; workflow child owns Fish domain/application and workflow tests; adapter child owns Fish adapters/extensions and adapter tests. Reviews do not edit concurrently.

Validation uses fake ports and fixtures without paid remote calls. Independent Codex and Claude Code Opus reviews cover policy bypass, compatibility, data loss, and boundaries.

Review refinements: pre-dispatch failures carry a typed proof to release workflow pending state while preserving the original CLI error. Upload slot repeat keys include the parent attempt and file digest. Shared credential-scoped audio journals allow a different destination to reuse generation. STT response journals prevent recharging after transcript export failures. A second termination signal exits stalled work with the recovery locks intact.
