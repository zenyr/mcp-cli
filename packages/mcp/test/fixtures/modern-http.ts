import { isRecord } from "@mcp-cli/core";

const tools = [{ name: "echo", inputSchema: { type: "object" } }];
const encoder = new TextEncoder();
const event = (message: Record<string, unknown>) =>
  encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", ...message })}\n\n`);
const complete = (id: unknown, result: Record<string, unknown>) =>
  Response.json({ jsonrpc: "2.0", id, result: { ...result, resultType: "complete" } });

/** Starts a 2026-07-28 Streamable HTTP MCP server whose `change` tool empties the tool list. */
export const startModernHttpFixture = () => {
  let changed = false;
  let subscription: unknown;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const message: unknown = await request.json();
      if (!isRecord(message) || message.id === undefined)
        return new Response(null, { status: 202 });
      const { id, method, params } = message;
      if (method === "server/discover")
        return complete(id, {
          supportedVersions: ["2026-07-28"],
          capabilities: { tools: { listChanged: true } },
          ttlMs: 0,
          cacheScope: "private",
        });
      if (method === "subscriptions/listen") {
        subscription = id;
        const acknowledged = event({
          method: "notifications/subscriptions/acknowledged",
          params: {
            _meta: { "io.modelcontextprotocol/subscriptionId": id },
            notifications: { toolsListChanged: true },
          },
        });
        // The listen stream stays open after the acknowledgement, like a real subscription.
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(acknowledged),
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      if (method === "tools/list")
        return complete(id, { tools: changed ? [] : tools, ttlMs: 0, cacheScope: "private" });
      // The notification precedes the result on one stream so the client sees them in order.
      if (method === "tools/call" && isRecord(params) && params.name === "change") {
        changed = true;
        const meta = { "io.modelcontextprotocol/subscriptionId": subscription };
        const changes = event({
          method: "notifications/tools/list_changed",
          params: { _meta: meta },
        });
        const result = event({ id, result: { content: [], resultType: "complete" } });
        return new Response(new Blob([changes, result]), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Not found" } });
    },
  });
  return { url: server.url.href, stop: () => server.stop(true) };
};
