import type { FetchLike } from "@modelcontextprotocol/client";
import type { Authorize } from "@mcp-cli/core";

const withHeaders = (init: RequestInit | undefined, extra: Record<string, string>): RequestInit => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return { ...init, headers };
};

/** Adds authorize headers to every request and retries a 401 once after a forced refresh. */
export const authorizedFetch =
  (authorize: Authorize, base: FetchLike = fetch): FetchLike =>
  async (url, init) => {
    const response = await base(url, withHeaders(init, await authorize({ refresh: false })));
    if (response.status !== 401) return response;
    await response.body?.cancel().catch(() => undefined);
    return base(url, withHeaders(init, await authorize({ refresh: true })));
  };
