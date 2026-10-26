import { isRecord } from "@mcp-cli/core";

export type HttpFixture = {
  url: string;
  /** Header values of every HTTP request the server received, in order. */
  seen: Record<string, string | null>[];
  stop: () => Promise<void>;
};

const json = (body: Record<string, unknown>) =>
  Response.json({ jsonrpc: "2.0", ...body }, { headers: { "mcp-session-id": "fixture" } });

const reply = (id: unknown, method: unknown, params: unknown): Response => {
  if (method === "initialize")
    return json({
      id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "http-fixture", version: "1.0.0" },
      },
    });
  if (method === "tools/list")
    return json({ id, result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } });
  if (method === "tools/call") {
    const args = isRecord(params) ? params.arguments : undefined;
    const text = isRecord(args) && typeof args.text === "string" ? args.text : "";
    return json({ id, result: { content: [{ type: "text", text }] } });
  }
  return json({ id, error: { code: -32601, message: "Method not found" } });
};

/** Starts a JSON-response Streamable HTTP MCP server that rejects requests failing `accept` with 401. */
export const startHttpFixture = (
  headerNames: string[],
  accept: (headers: Headers) => boolean,
  redirect?: { status: 307 | 308; target?: string },
): HttpFixture => {
  const seen: HttpFixture["seen"] = [];
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      seen.push(Object.fromEntries(headerNames.map((name) => [name, request.headers.get(name)])));
      if (redirect && new URL(request.url).pathname === "/redirect")
        return Response.redirect(redirect.target ?? server.url.href, redirect.status);
      if (!accept(request.headers)) return new Response("unauthorized", { status: 401 });
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const message: unknown = await request.json();
      if (!isRecord(message) || message.id === undefined)
        return new Response(null, { status: 202 });
      return reply(message.id, message.method, message.params);
    },
  });
  return { url: server.url.href, seen, stop: () => server.stop(true) };
};
