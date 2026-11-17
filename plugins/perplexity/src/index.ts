import { definePlugin } from "@mcp-cli/core";
import { normalizeArgv } from "./argv";

const MESSAGE =
  "Positional words become one user message. Use --messages with a JSON array for multi-turn context.";

export default definePlugin({
  name: "pplx",
  summary: "Perplexity web search, answers, reasoning and deep research",
  auth: { type: "apiKey", env: "PERPLEXITY_API_KEY" },
  workspaces: { credentialEnv: ["PERPLEXITY_API_KEY"] },
  // An explicit PERPLEXITY_API_KEY takes precedence over the key stored by `mcp-cli login pplx`.
  connection: (env) => ({
    type: "http",
    url: env.PERPLEXITY_MCP_URL ?? "https://api.perplexity.ai/mcp",
  }),
  commands: {
    perplexity_search: {
      path: ["search"],
      summary: "Search the web and list ranked results without AI synthesis",
      details: "Positional words become the query.",
      examples: [
        "pplx search latest bun release notes --max-results 5",
        'pplx search "MCP spec" --search-domain-filter \'["modelcontextprotocol.io"]\'',
        "pplx search rust 2024 edition --search-type fast --search-recency-filter month",
      ],
    },
    perplexity_ask: {
      path: ["ask"],
      summary: "Answer a question quickly with cited web sources",
      details: MESSAGE,
      examples: [
        "pplx ask what changed in TypeScript 5.9",
        "pplx ask AI chip export news --search-recency-filter day",
      ],
    },
    perplexity_reason: {
      path: ["reason"],
      summary: "Answer with step-by-step reasoning and cited web sources",
      details: MESSAGE,
      examples: ["pplx reason compare SQLite WAL and rollback journal for concurrent readers"],
    },
    perplexity_research: {
      path: ["research"],
      summary: "Run slow, multi-source deep research with citations",
      details: MESSAGE,
      examples: ["pplx research state of WebGPU support across browsers"],
    },
  },
  extensions: { commands: [], normalizeArgv },
  quickstart: [
    {
      command: "search --search-type fast bun release notes",
      summary: "List web results with URLs and snippets",
    },
    {
      command: "ask --search-recency-filter week what changed in Bun",
      summary: "Get a quick cited answer",
    },
  ],
  skill: `Use pplx search <query> for ranked URLs and snippets without synthesis; add --search-type fast for routine lookups.
Use pplx ask <question> for quick cited answers, pplx reason for comparisons or multi-step analysis, and pplx research only for deep multi-source reports because it takes minutes and costs the most.
Positional words become the query or a single user message; use --messages with a JSON array for multi-turn context.
Narrow sources with --search-recency-filter hour|day|week|month|year and --search-domain-filter '["example.com","-reddit.com"]'.
Every call spends Perplexity API credits; cite the returned URLs instead of repeating the same query.`,
});
