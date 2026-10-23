import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRecord,
  UsageError,
  type Connection,
  type ToolResult,
  type ToolSession,
} from "@mcp-cli/core";

const result = (data: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
  ...(isError && { isError }),
});
const failure = (category: string, data: Record<string, unknown>): ToolResult =>
  result({ ...data, ok: false, category }, true);

const download = async (
  config: Extract<Connection, { type: "http" }>,
  input: Record<string, unknown>,
  timeout: number,
  request: typeof fetch,
  maxBytes: number,
): Promise<ToolResult> => {
  if (typeof input.url !== "string") throw new UsageError("Download URL is required");
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !config.webApi?.downloadHosts?.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new UsageError("Download requires an approved HTTPS host");
  const response = await request(url, {
    headers: config.headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) return failure("network", { status: response.status });
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    return failure("limit", { error: "Download exceeds byte limit", limit_bytes: maxBytes });
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return failure("limit", { error: "Download exceeds byte limit", limit_bytes: maxBytes });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = Buffer.concat(chunks);
  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  if (input.save === true) {
    const directory = await mkdtemp(join(tmpdir(), "mcp-cli-attachment-"));
    await chmod(directory, 0o700);
    const path = join(directory, crypto.randomUUID());
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    return result({ ok: true, path, size, mimeType, untrusted: true });
  }
  const textual = /^(text\/|application\/(json|xml|javascript)(;|$))/.test(mimeType);
  return result({
    ok: true,
    content: bytes.toString(textual ? "utf8" : "base64"),
    encoding: textual ? "utf8" : "base64",
    mimeType,
    size,
    untrusted: true,
  });
};

export const connectWebApi = (
  config: Extract<Connection, { type: "http" }>,
  openMcp: () => Promise<ToolSession>,
  timeout = 30000,
  request: typeof fetch = fetch,
): ToolSession => {
  let pending: Promise<ToolSession> | undefined;
  const mcp = () => (pending ??= openMcp());
  const callTool = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const tool = config.webApi?.tools.find((item) => item.name === name);
    if (!tool) return (await mcp()).callTool(name, input);
    const authorization =
      Object.entries(config.headers ?? {}).find(
        ([key]) => key.toLowerCase() === "authorization",
      )?.[1] ?? "";
    const credential = authorization.replace(/^Bearer /, "");
    if (tool.requiredTokenPrefix && !credential.startsWith(tool.requiredTokenPrefix))
      return failure("authentication", {
        error: tool.credentialError ?? "credential_type_required",
      });
    try {
      if (tool.download)
        return await download(
          config,
          input,
          timeout,
          request,
          tool.maxDownloadBytes ?? 5 * 1024 * 1024,
        );
      const url = new URL(tool.method, config.webApi?.url);
      const form = tool.bodyEncoding === "form";
      const body = form
        ? new URLSearchParams(
            Object.entries(input)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key,
                typeof value === "string" ? value : JSON.stringify(value),
              ]),
          ).toString()
        : JSON.stringify(input);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(url, {
          method: "POST",
          headers: {
            ...config.headers,
            "content-type": form
              ? "application/x-www-form-urlencoded"
              : "application/json; charset=utf-8",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
        const retryAfter = response.headers.get("retry-after");
        if (
          response.status === 429 &&
          tool.annotations?.readOnlyHint &&
          attempt === 0 &&
          retryAfter === "0"
        ) {
          await response.body?.cancel();
          continue;
        }
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          return failure("network", {
            status: response.status,
            error: "invalid_response",
            outcome: tool.annotations?.readOnlyHint ? "read" : "unknown",
          });
        }
        if (!isRecord(data))
          return failure("network", {
            status: response.status,
            error: "invalid_response",
            outcome: tool.annotations?.readOnlyHint ? "read" : "unknown",
          });
        if (!response.ok || data.ok !== true) {
          const category =
            response.status === 429
              ? "rate_limit"
              : (tool.errorCategories?.[String(data.error)] ??
                (response.status === 401 ? "authentication" : "api"));
          return failure(category, {
            ...data,
            status: response.status,
            ...(retryAfter !== null && { retryAfter }),
            ...(response.status >= 500 && { outcome: "unknown" }),
          });
        }
        const tokenKind = tool.credentialKinds
          ? (Object.entries(tool.credentialKinds).find(([prefix]) =>
              credential.startsWith(prefix),
            )?.[1] ?? "unknown")
          : undefined;
        return result(tokenKind ? { ...data, token_kind: tokenKind } : data);
      }
      return failure("rate_limit", { error: "ratelimited" });
    } catch (error) {
      if (error instanceof UsageError) return failure("usage", { error: error.message });
      return failure("network", {
        error:
          error instanceof Error && error.name === "TimeoutError" ? "timeout" : "request_failed",
        outcome: tool.annotations?.readOnlyHint ? "read" : "unknown",
      });
    }
  };
  return {
    callTool,
    listTools: async () => (await mcp()).listTools(),
    listResources: async () => (await mcp()).listResources(),
    listResourceTemplates: async () => (await mcp()).listResourceTemplates(),
    readResource: async (uri) => (await mcp()).readResource(uri),
    listPrompts: async () => (await mcp()).listPrompts(),
    getPrompt: async (name, args) => (await mcp()).getPrompt(name, args),
    close: async () => {
      if (pending) await (await pending).close();
    },
  };
};
