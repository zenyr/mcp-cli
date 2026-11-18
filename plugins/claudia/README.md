# Claudia

`claudia` connects to the public [Claudia gallery MCP server](https://claudia.gallery/agents/)
at `https://claudia.gallery/mcp` over Streamable HTTP. No account or API key is required.
The server provides read-only character references, gallery images, filmmaking guides,
and prompt preparation. It does not generate or purchase images or video.

| Command                   | MCP tool        | Use                                      |
| ------------------------- | --------------- | ---------------------------------------- |
| `claudia recipe get`      | `get_recipe`    | Current end-to-end filmmaking method     |
| `claudia canon get`       | `claudia_canon` | Claudia's identity, looks and references |
| `claudia kit get`         | `get_kit`       | Runnable filmmaking toolkit              |
| `claudia guide get`       | `get_guide`     | One filmmaking guide by topic            |
| `claudia film plan`       | `plan_film`     | Film plan and cost estimate              |
| `claudia film list`       | `list_films`    | Film list or one film's details          |
| `claudia film record get` | `get_record`    | One production document of a film        |
| `claudia shot write`      | `write_shot`    | Video shot prompt                        |
| `claudia prompt build`    | `build_prompt`  | Image prompt from the canon              |
| `claudia prompt check`    | `check_prompt`  | Image or video prompt check              |
| `claudia image search`    | `search_images` | Gallery search                           |
| `claudia image browse`    | `browse_images` | Gallery browsing by film, batch or set   |
| `claudia image get`       | `get_image`     | One image and its original prompt        |
| `claudia agent-skill get` | `get_skill`     | Claudia's installable agent skill        |

```sh
claudia recipe get
claudia canon get --detail looks
claudia film list
claudia film plan --scale studio --song-seconds 200 --has '["higgsfield"]'
claudia film record get --film bliss --doc readme --max-chars 4000
claudia guide get --topic seedance --offset 4000 --max-chars 4000
claudia image search --query "chroma-key green" --limit 5
claudia image get --id sp-02-open.siren-mcu.2
claudia prompt build --scene "on a stage"
claudia prompt check --prompt "A singer on stage" --kind video
claudia shot write --first-frame "a stage" --lines '[{"words":"first line"}]'
```

Use `claudia <command> --help` or `claudia schema <command>` for arguments.
Array flags take a JSON array, and `claudia schema <command>` shows each item's fields.
Use `--input` or `--input-file` for larger structured inputs.
`mcp-cli claudia` exposes the same commands.

- `--help`, `methods`, `schema`, and `skill` use the checked-in snapshot without contacting the server.
- `claudia skill` prints this CLI's workflow. `claudia agent-skill get` returns the server's own agent skill.
- `claudia prompt` is this service's command group. `claudia prompts` lists MCP server prompts.
- Server responses name MCP tools such as `list_films`. `claudia methods` maps each tool to its command.
- Plain output replaces image data with a size line. Add `--json` to receive the base64 data.
- The snapshot keeps `film`, `style`, `doc`, and `topic` open, so ids released after it still work.

Regenerate the snapshot with `bun run generate claudia`.
