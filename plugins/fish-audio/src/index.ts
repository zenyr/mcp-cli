import { definePlugin } from "@mcp-cli/core";
import { commands, groups, quickstart, skill } from "./commands";
import { uploadFile } from "./upload";
import { extensions } from "./extensions";
import { formatBalanceResult } from "./balance-format";
export default definePlugin({
  name: "fish-audio",
  summary: "Fish Audio text-to-speech, transcription and voice tools",
  commands,
  groups,
  quickstart,
  skill,
  extensions,
  uploadFile,
  formatResult: (result, hostFormat) => formatBalanceResult(result, hostFormat),
  auth: { type: "oauth", scopes: ["mcp"], clientName: "mcp-cli", redirectPort: 18923 },
  // An explicit FISH_ACCESS_TOKEN takes precedence over credentials stored by `mcp-cli login fish-audio`.
  connection: (env) => {
    const url = env.FISH_MCP_URL ?? "https://api.fish.audio/mcp";
    const token = env.FISH_ACCESS_TOKEN;
    if (!token) return { type: "http", url };
    return { type: "http", url, authorize: async () => ({ Authorization: `Bearer ${token}` }) };
  },
});
