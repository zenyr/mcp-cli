export type SlackTarget = "mcp" | "web";
export type SlackProfile = {
  method: "token" | "pkce" | "auto";
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
export type SlackDetection = {
  appId: string;
  checkedAt?: number;
  pkce?: boolean;
  rotation?: boolean;
  mcp?: boolean;
  redirectUris?: string[];
  scopes?: string[];
  available: boolean;
};
