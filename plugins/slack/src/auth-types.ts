export type SlackTarget = "mcp" | "web";
export type SlackProfile = {
  method: "token" | "pkce";
  clientId?: string;
  appId?: string;
  teamId?: string;
  redirectUri?: string;
  scopes?: string[];
  pkceEnabled?: boolean;
  mcpEnabled?: boolean;
  distribution?: "internal" | "marketplace" | "unlisted";
};
export type SlackConfiguration = { mcp: SlackProfile; web: SlackProfile };
