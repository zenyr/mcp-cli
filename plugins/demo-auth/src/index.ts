import { definePlugin, type CommandSpec, type WebApiConfig } from "@mcp-cli/core";
import { SERVICE, demoAuthSupport } from "./auth";

type WebTool = WebApiConfig["tools"][number];
const authTest: WebTool = {
  name: "web.auth.test",
  method: "auth.test",
  bodyEncoding: "form",
  description: "Return the identity behind the selected token",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, idempotentHint: false },
};
const webTools: WebTool[] = [
  authTest,
  {
    name: "web.search.messages",
    method: "search.messages",
    bodyEncoding: "form",
    description: "Search messages with a form-encoded query",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        count: { type: "integer" },
        page: { type: "integer" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, idempotentHint: false },
  },
];
const apiCommands: CommandSpec[] = webTools.map((tool) => ({
  ...tool,
  path: tool === authTest ? ["auth", "check"] : ["message", "search"],
}));

/** Hidden fixture for host auth contracts: API key alternates, AuthSupport and a Web API. */
export default definePlugin({
  name: SERVICE,
  summary: "Hidden auth contract fixture",
  workspaces: { credentialEnv: ["DEMO_AUTH_TOKEN", "DEMO_AUTH_BOT_TOKEN"] },
  apiCommands,
  authSupport: demoAuthSupport,
  auth: {
    type: "apiKey",
    env: "DEMO_AUTH_TOKEN",
    alternates: [
      { flag: "user", base: true, env: "DEMO_AUTH_TOKEN", summary: "Use the user token" },
      { flag: "bot", env: "DEMO_AUTH_BOT_TOKEN", summary: "Use the bot token" },
    ],
  },
  connection: (env) => ({
    type: "http",
    url: env.DEMO_AUTH_MCP_URL ?? "http://127.0.0.1:1/mcp",
    webApi: { url: env.DEMO_AUTH_WEB_URL ?? "http://127.0.0.1:1/api/", tools: webTools },
  }),
});
