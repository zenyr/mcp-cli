import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Connection, ToolSession } from "@mcp-cli/core";

export type ConnectOptions = {
  timeoutMs?: number;
  callTimeoutMs?: number;
  maxCallTimeoutMs?: number;
  terminateTimeoutMs?: number;
};

export class MissingToolsCapabilityError extends Error {
  override name = "MissingToolsCapabilityError";
}

const positive = (name: string, value: number | undefined, fallback: number): number => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0)
    throw new Error(`${name} must be a positive number`);
  return resolved;
};

const bounded = async (task: Promise<void>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([task.catch(() => undefined), expired]);
  } finally {
    clearTimeout(timer);
  }
};

const openTransport = (config: Connection) => {
  if (config.type === "stdio")
    return {
      transport: new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        stderr: "inherit",
      }),
      terminate: undefined,
    };
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
  });
  return { transport, terminate: () => transport.terminateSession() };
};

export const connect = async (
  config: Connection,
  options: ConnectOptions = {},
): Promise<ToolSession> => {
  const timeout = positive("Timeout", options.timeoutMs, 30000);
  const callTimeout = positive("Call timeout", options.callTimeoutMs, timeout);
  const maxTotalTimeout =
    options.maxCallTimeoutMs === undefined
      ? undefined
      : positive("Max call timeout", options.maxCallTimeoutMs, timeout);
  const terminateTimeout = positive("Terminate timeout", options.terminateTimeoutMs, 2000);
  const client = new Client(
    { name: "mcp-cli", version: "0.1.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const { transport, terminate } = openTransport(config);
  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
  // A no-op progress handler makes the SDK send a progress token so progress can reset the timeout.
  const callOptions = {
    timeout: callTimeout,
    resetTimeoutOnProgress: true,
    onprogress: () => undefined,
    ...(maxTotalTimeout !== undefined && { maxTotalTimeout }),
  };
  return {
    listTools: async () => {
      if (!client.getServerCapabilities()?.tools)
        throw new MissingToolsCapabilityError("Server does not advertise the tools capability");
      const { tools } = await client.listTools(undefined, { timeout });
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
      }));
    },
    callTool: async (name, input) => {
      const result = await client.callTool({ name, arguments: input }, callOptions);
      return {
        content: result.content.map((item) => ({ ...item })),
        structuredContent: result.structuredContent,
        isError: result.isError,
      };
    },
    close: async () => {
      if (terminate) await bounded(terminate(), terminateTimeout);
      await client.close();
    },
  };
};
