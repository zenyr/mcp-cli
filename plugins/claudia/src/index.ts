import { definePlugin } from "@mcp-cli/core";
import { formatResult } from "./output";
import { sanitizeTools } from "./schema";

export default definePlugin({
  name: "claudia",
  summary: "Browse Claudia's gallery, character canon and filmmaking guides",
  connection: () => ({ type: "http", url: "https://claudia.gallery/mcp" }),
  sanitizeTools,
  formatResult,
  commands: {
    get_recipe: { path: ["recipe", "get"], summary: "Read the current filmmaking recipe" },
    claudia_canon: { path: ["canon", "get"], summary: "Read Claudia's identity and looks" },
    get_kit: { path: ["kit", "get"], summary: "Get the runnable filmmaking toolkit" },
    get_guide: {
      path: ["guide", "get"],
      summary: "Read a filmmaking guide",
      examples: ["claudia guide get --topic seedance --offset 4000 --max-chars 4000"],
    },
    plan_film: {
      path: ["film", "plan"],
      summary: "Plan a film and estimate its cost",
      examples: [
        'claudia film plan --scale studio --song-seconds 200 --has \'["higgsfield","suno"]\'',
      ],
    },
    list_films: { path: ["film", "list"], summary: "List films or inspect one film" },
    get_record: {
      path: ["film", "record", "get"],
      summary: "Read a film's production records",
      examples: ["claudia film record get --film bliss --doc readme --max-chars 4000"],
    },
    write_shot: {
      path: ["shot", "write"],
      summary: "Prepare a video shot prompt",
      examples: [
        'claudia shot write --first-frame "a stage" --lines \'[{"words":"first line","start":12.5}]\'',
      ],
    },
    check_prompt: {
      path: ["prompt", "check"],
      summary: "Check an image or video prompt",
      examples: ['claudia prompt check --prompt "A singer on stage" --kind video'],
    },
    build_prompt: { path: ["prompt", "build"], summary: "Build an image prompt from the canon" },
    search_images: {
      path: ["image", "search"],
      summary: "Search gallery images",
      examples: ['claudia image search --query "chroma-key green" --limit 5'],
    },
    browse_images: { path: ["image", "browse"], summary: "Browse gallery images" },
    get_image: {
      path: ["image", "get"],
      summary: "Get an image and its original prompt",
      examples: ["claudia image get --id sp-02-open.siren-mcu.2 --include-image --json"],
    },
    get_skill: { path: ["agent-skill", "get"], summary: "Get the installable Claudia agent skill" },
  },
  groups: {
    recipe: "Current end-to-end filmmaking method",
    canon: "Claudia's identity, looks and reference images",
    kit: "Runnable toolkit for making a film",
    guide: "Filmmaking guides by topic",
    film: "Film plans, the film list and production records",
    "film record": "Production documents of one film",
    shot: "Video shot prompts",
    prompt: "Image and video prompt building and checks",
    image: "Gallery image search, browsing and prompts",
    "agent-skill": "Claudia's own agent skill, separate from `claudia skill`",
  },
  quickstart: [
    { command: "recipe get", summary: "Start with the current filmmaking method" },
    { command: "canon get --detail looks", summary: "Read the character canon" },
    {
      command: 'image search --query "chroma-key green" --limit 5',
      summary: "Find reference images",
    },
  ],
  skill: `Claudia is a public, read-only MCP service with no account or API key.
Start with claudia recipe get, then claudia canon get and claudia film plan.
Use claudia kit get for the runnable toolkit and claudia shot write for shot prompts.
Check prompts with claudia prompt check before generating images or video elsewhere.
claudia prompt is this service's group; claudia prompts lists MCP server prompts instead.
Use claudia image search, image browse and image get to find reference images.
Use claudia guide get and claudia film record get for details; page long documents with --offset and --max-chars.
Plain output replaces image data with a size line; add --json to image get --include-image or canon get --include-images for image bytes.
Responses name MCP tools such as list_films or get_record; claudia methods maps each tool to its command.
These tools prepare plans and prompts; generation services have their own costs.`,
});
