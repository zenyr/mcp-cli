import { definePlugin } from "@mcp-cli/core";

export default definePlugin({
  name: "claudia",
  summary: "Browse Claudia's gallery, character canon and filmmaking guides",
  connection: () => ({ type: "http", url: "https://claudia.gallery/mcp" }),
  commands: {
    get_recipe: { path: ["recipe"], summary: "Read the current filmmaking recipe" },
    claudia_canon: { path: ["canon"], summary: "Read Claudia's identity and looks" },
    plan_film: { path: ["film", "plan"], summary: "Plan a film and estimate its cost" },
    list_films: { path: ["film", "list"], summary: "List films or inspect one film" },
    get_kit: { path: ["kit"], summary: "Get the filmmaking toolkit" },
    write_shot: { path: ["shot", "write"], summary: "Prepare a video shot prompt" },
    check_prompt: { path: ["prompt", "check"], summary: "Check an image or video prompt" },
    build_prompt: { path: ["prompt", "build"], summary: "Build an image prompt from the canon" },
    get_guide: { path: ["guide"], summary: "Read a filmmaking guide" },
    get_record: { path: ["record"], summary: "Read a film's production records" },
    search_images: { path: ["image", "search"], summary: "Search gallery images" },
    browse_images: { path: ["image", "browse"], summary: "Browse gallery images" },
    get_image: { path: ["image", "get"], summary: "Get an image and its original prompt" },
    get_skill: { path: ["agent-skill"], summary: "Get Claudia's agent skill installation guide" },
  },
  quickstart: [
    { command: "recipe", summary: "Start with the current filmmaking method" },
    { command: "canon", summary: "Read the character canon" },
    {
      command: 'image search --query "chroma-key green" --limit 5',
      summary: "Find reference images",
    },
  ],
  skill: `Claudia is a public, read-only MCP service with no account or API key.
Start with claudia recipe, then claudia canon and claudia film plan.
Use claudia kit for the runnable toolkit and claudia shot write for shot prompts.
Check prompts with claudia prompt check before generating images or video elsewhere.
Use claudia image search, image browse and image get to find reference images.
Use claudia guide and claudia record for production details; paginate long documents.
Prefer small images and cache downloaded assets.
These tools prepare plans and prompts; generation services have their own costs.`,
});
