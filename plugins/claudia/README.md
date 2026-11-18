# Claudia

`claudia` connects to the public [Claudia gallery MCP server](https://claudia.gallery/agents/)
at `https://claudia.gallery/mcp` over Streamable HTTP. No account or API key is required.
The server provides read-only character references, gallery images, filmmaking guides,
and prompt preparation. It does not generate or purchase images or video.

```sh
claudia recipe
claudia canon --detail looks
claudia film list
claudia image search --query "chroma-key green" --limit 5
claudia image browse --limit 5
claudia image get --id sp-02-open.siren-mcu.2
claudia guide --topic seedance
claudia prompt build --scene "on a stage"
claudia prompt check --prompt "A singer on stage" --kind video
claudia film plan --scale studio --song-seconds 200
claudia kit
```

Use `claudia <command> --help` or `claudia schema <command>` for arguments.
Use `--input` or `--input-file` for structured inputs such as shot timelines.
`mcp-cli claudia` exposes the same commands. `--help`, `methods`, `schema`,
and `skill` use the checked-in snapshot without contacting the server.

Regenerate the snapshot with `bun run generate claudia`.
