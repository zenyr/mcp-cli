import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Connection, ToolSession } from "@mcp-cli/core";

export type ConnectOptions = { timeoutMs?: number };

export const connect = async (
  config: Connection,
  options: ConnectOptions = {},
): Promise<ToolSession> => {
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error("Timeout must be a positive number");
  const client = new Client(
    { name: "mcp-cli", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport =
    config.type === "stdio"
      ? new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: config.env,
          stderr: "inherit",
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
        });
  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
  return {
    listTools: async () => {
      const { tools } = await client.listTools(undefined, { timeout });
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
      }));
    },
    callTool: async (name, input) => {
      const result = await client.callTool({ name, arguments: input }, { timeout });
      return {
        content: result.content.map((item) => ({ ...item })),
        structuredContent: result.structuredContent,
        isError: result.isError,
      };
    },
    close: () => client.close(),
  };
};
