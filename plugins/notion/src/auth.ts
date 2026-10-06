import type { Authorize } from "@mcp-cli/core";

/** Credential seam for Notion; an OAuth store with a refresh lock can replace the env source later. */
export type NotionTokenSource = {
  read: () => Promise<string | undefined>;
  refresh?: () => Promise<string | undefined>;
};

export const envTokenSource = (env: Record<string, string | undefined>): NotionTokenSource => ({
  read: async () => env.NOTION_MCP_TOKEN || undefined,
});

/** Without a `refresh` capability the retry after 401 reuses the current token once. */
export const bearerAuthorize =
  (source: NotionTokenSource): Authorize =>
  async ({ refresh }): Promise<Record<string, string>> => {
    const token = refresh && source.refresh ? await source.refresh() : await source.read();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
