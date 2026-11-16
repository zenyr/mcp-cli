import { sessionTools } from "./session-tools";
import { validateTools } from "@mcp-cli/schema";
import { connectWebApi } from "./web-api";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { CatalogSession, Connection, ResourceContent, ToolSession } from "@mcp-cli/core";
import { decodeManifest } from "@mcp-cli/core";
import { authorizedFetch } from "./authorize";
import { authFailure } from "./oauth";

export { login, type LoginOptions, type LoginUi } from "./login";
export { LoginError, startLoopback } from "./loopback";
export { oauthAuthorize, type OAuthAuthorizeOptions } from "./oauth";

export type ConnectOptions = {
  sessionTools?: boolean;
  timeoutMs?: number;
  callTimeoutMs?: number;
  maxCallTimeoutMs?: number;
  terminateTimeoutMs?: number;
};

/** The server did not advertise the capability an operation needs. */
export abstract class MissingCapabilityError extends Error {
  abstract readonly capability: "tools" | "resources" | "prompts";
}
export class MissingToolsCapabilityError extends MissingCapabilityError {
  override name = "MissingToolsCapabilityError";
  readonly capability = "tools";
}
export class MissingResourcesCapabilityError extends MissingCapabilityError {
  override name = "MissingResourcesCapabilityError";
  readonly capability = "resources";
}
export class MissingPromptsCapabilityError extends MissingCapabilityError {
  override name = "MissingPromptsCapabilityError";
  readonly capability = "prompts";
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

type ContentItem = { uri: string; mimeType?: string; text?: string; blob?: string };
const resourceContent = ({ uri, mimeType, text, blob }: ContentItem): ResourceContent => {
  const meta = { uri, ...(mimeType !== undefined && { mimeType }) };
  if (typeof text === "string") return { ...meta, text };
  return { ...meta, blob: blob ?? "" };
};

// The SDK walks every nextCursor page when list calls omit a cursor.
const catalog = (client: Client, timeout: number, callTimeout: number): CatalogSession => {
  const ensure = (capability: "resources" | "prompts"): void => {
    const advertised = client.getServerCapabilities()?.[capability];
    if (advertised) return;
    const message = `Server does not advertise the ${capability} capability`;
    throw capability === "resources"
      ? new MissingResourcesCapabilityError(message)
      : new MissingPromptsCapabilityError(message);
  };
  return {
    listResources: async () => {
      ensure("resources");
      const { resources } = await client.listResources(undefined, { timeout });
      return resources.map(({ uri, name, title, description, mimeType, size }) => ({
        uri,
        name,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(mimeType !== undefined && { mimeType }),
        ...(size !== undefined && { size }),
      }));
    },
    listResourceTemplates: async () => {
      ensure("resources");
      const { resourceTemplates } = await client.listResourceTemplates(undefined, { timeout });
      return resourceTemplates.map(({ uriTemplate, name, title, description, mimeType }) => ({
        uriTemplate,
        name,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(mimeType !== undefined && { mimeType }),
      }));
    },
    readResource: async (uri) => {
      ensure("resources");
      const { contents } = await client.readResource({ uri }, { timeout: callTimeout });
      return contents.map(resourceContent);
    },
    listPrompts: async () => {
      ensure("prompts");
      const { prompts } = await client.listPrompts(undefined, { timeout });
      return prompts.map(({ name, title, description, arguments: args = [] }) => ({
        name,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        arguments: args.map((arg) => ({
          name: arg.name,
          ...(arg.description !== undefined && { description: arg.description }),
          ...(arg.required !== undefined && { required: arg.required }),
        })),
      }));
    },
    getPrompt: async (name, args) => {
      ensure("prompts");
      const result = await client.getPrompt({ name, arguments: args }, { timeout: callTimeout });
      return {
        ...(result.description !== undefined && { description: result.description }),
        messages: result.messages.map(({ role, content }) => ({ role, content: { ...content } })),
      };
    },
  };
};

const openTransport = (config: Connection) => {
  if (config.type === "stdio")
    return {
      transport: new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
        stderr: "inherit",
      }),
      terminate: undefined,
    };
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
    ...(config.authorize && { fetch: authorizedFetch(config.authorize) }),
  });
  return { transport, terminate: () => transport.terminateSession() };
};

const connectMcp = async (
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
  const discovery = sessionTools(() => fetchTools());
  const client = new Client(
    { name: "mcp-cli", version: "0.1.0" },
    {
      versionNegotiation: { mode: "auto" },
      ...(options.sessionTools && {
        listChanged: {
          tools: { autoRefresh: false, debounceMs: 0, onChanged: discovery.invalidate },
        },
      }),
    },
  );
  const { transport, terminate } = openTransport(config);
  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw authFailure(error) ?? error;
  }
  // A no-op progress handler makes the SDK send a progress token so progress can reset the timeout.
  const callOptions = {
    timeout: callTimeout,
    resetTimeoutOnProgress: true,
    onprogress: () => undefined,
    ...(maxTotalTimeout !== undefined && { maxTotalTimeout }),
  };
  const fetchTools = async () => {
    if (!client.getServerCapabilities()?.tools)
      throw new MissingToolsCapabilityError("Server does not advertise the tools capability");
    const { tools } = await client.listTools(undefined, {
      timeout,
      ...(options.sessionTools && { cacheMode: "refresh" as const }),
    });
    const definitions = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
      ...(tool.annotations && { annotations: tool.annotations }),
    }));
    if (options.sessionTools) {
      decodeManifest({ version: 2, service: "session", tools: definitions });
      validateTools(definitions);
    }
    return definitions;
  };
  if (options.sessionTools)
    client.setNotificationHandler("notifications/tools/list_changed", discovery.invalidate);
  return {
    ...catalog(client, timeout, callTimeout),
    listTools: options.sessionTools ? discovery.list : fetchTools,
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

export const connect = async (
  config: Connection,
  options: ConnectOptions = {},
): Promise<ToolSession> =>
  config.type === "http" && config.webApi
    ? connectWebApi(
        config,
        () => connectMcp(config, options),
        options.callTimeoutMs ?? options.timeoutMs,
      )
    : connectMcp(config, options);
