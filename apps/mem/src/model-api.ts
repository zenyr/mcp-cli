import { Effect, Schema } from "effect";
import type { Env, Settings } from "./types";
import { fail, isRecord } from "./values";

export const requestHeaders = (settings: Settings, env: Env): Headers => {
  try {
    const headers = new Headers(settings.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const key = env.MEM_API_KEY || settings.apiKey;
    if (key) headers.set("Authorization", `Bearer ${key}`);
    return headers;
  } catch {
    return fail("INVALID_CONFIG", "Invalid model request headers.");
  }
};

export const readResponseText = async (
  stream: ReadableStream<Uint8Array> | null,
  limit = 262144,
): Promise<string> => {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return fail("MODEL_OUTPUT_OVERFLOW", "Model response exceeded its read limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
};

export class ModelListError extends Schema.TaggedError<ModelListError>()("ModelListError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export const listModels = (
  settings: Settings,
  env: Env = {},
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) =>
  Effect.tryPromise({
    try: async (signal): Promise<string[]> => {
      if (!settings.baseUrl)
        throw new ModelListError({
          code: "MODEL_URL_REQUIRED",
          message: "Enter the API base URL first.",
        });
      const response = await request(`${settings.baseUrl.replace(/\/$/, "")}/models`, {
        headers: requestHeaders(settings, env),
        signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(settings.timeoutMs, 15000))]),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelListError({
          code: "MODEL_LIST_HTTP",
          message: `Model list request failed (HTTP ${response.status}).`,
        });
      }
      let value: unknown;
      try {
        value = JSON.parse(await readResponseText(response.body, 2 * 1024 * 1024));
      } catch {
        throw new ModelListError({
          code: "MODEL_LIST_PROTOCOL",
          message: "The server returned an invalid model list.",
        });
      }
      if (!isRecord(value) || !Array.isArray(value.data))
        throw new ModelListError({
          code: "MODEL_LIST_PROTOCOL",
          message: "The server returned an invalid model list.",
        });
      const names: string[] = [];
      for (const item of value.data) {
        if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim())
          throw new ModelListError({
            code: "MODEL_LIST_PROTOCOL",
            message: "The server returned an invalid model ID.",
          });
        names.push(item.id);
      }
      return [...new Set(names)].sort();
    },
    catch: (error) =>
      error instanceof ModelListError
        ? error
        : new ModelListError({
            code: "MODEL_LIST_UNAVAILABLE",
            message: "Could not load models. Check the address and authentication.",
          }),
  });
