import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";

export default definePlugin({
  name: "suno",
  summary: "Suno music generation and library",
  commands,
  groups,
  quickstart,
  skill,
  auth: { type: "oauth" },
  connection: () => ({ type: "http", url: "https://api.suno.com/mcp" }),
});
