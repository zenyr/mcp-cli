import type { FetchLike } from "@modelcontextprotocol/client";
import type { Authorize } from "@mcp-cli/core";

type AuthHeaders = Record<string, string>;

const withHeaders = (init: RequestInit | undefined, extra: AuthHeaders): RequestInit => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return { ...init, headers };
};

/** Adds authorize headers to every request and retries a 401 once after a shared forced refresh. */
export const authorizedFetch = (authorize: Authorize, base: FetchLike = fetch): FetchLike => {
  let refreshing: Promise<AuthHeaders> | undefined;
  let generation = 0;
  const refresh = (): Promise<AuthHeaders> => {
    refreshing ??= authorize({ refresh: true })
      .then((headers) => {
        generation += 1;
        return headers;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  return async (url, init) => {
    const started = generation;
    const response = await base(url, withHeaders(init, await authorize({ refresh: false })));
    if (response.status !== 401) return response;
    await response.body?.cancel().catch(() => undefined);
    // A refresh that completed after this request started already replaced the rejected headers.
    const headers = generation !== started ? await authorize({ refresh: false }) : await refresh();
    return base(url, withHeaders(init, headers));
  };
};
