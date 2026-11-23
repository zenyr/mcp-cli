import { UsageError, type AuthSupport, type AuthSupportContext } from "@mcp-cli/core";
import { Cause, Effect, Exit, Schema } from "effect";
import { decodeSettings, loadDraftSettings } from "@mcp-cli/mem/settings";
import { listModels } from "@mcp-cli/mem/model-api";
import { testConfiguration } from "@mcp-cli/mem/configuration-test";

const Input = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.Literals(["default", "enabled", "disabled"])),
  headers: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  clearApiKey: Schema.optional(Schema.Boolean),
  hasApiKey: Schema.optional(Schema.Boolean),
});
const decodeInput = (value: unknown) => {
  try {
    const input = Schema.decodeUnknownSync(Input)(value, { onExcessProperty: "error" });
    const headers: unknown = input.headers?.trim() ? JSON.parse(input.headers) : {};
    return {
      settings: decodeSettings({
        baseUrl: input.baseUrl?.trim() ?? "",
        model: input.model?.trim() ?? "",
        thinking: input.thinking ?? "default",
        headers,
      }),
      apiKey: input.apiKey?.trim() ?? "",
      clearApiKey: input.clearApiKey === true,
    };
  } catch {
    throw new UsageError(
      "Check the API address and headers. Headers must be a JSON object of string values.",
    );
  }
};

const draftSettings = async (context: AuthSupportContext, value: unknown) => {
  const decoded = decodeInput(value);
  const { baseUrl, model, thinking, headers } = decoded.settings;
  const settings = await loadDraftSettings(
    { baseUrl, model, thinking: thinking ?? "default", headers: headers ?? {} },
    context.env,
  );
  const saved = decoded.clearApiKey ? undefined : await context.store.read("mem");
  const apiKey = decoded.apiKey || saved?.accessToken;
  return { ...settings, ...(apiKey ? { apiKey } : {}) };
};

// Effect failures are rethrown as plain errors so callers always see a nonempty, secret-free message.
const run = async <A>(effect: Effect.Effect<A, { message: string }>, fallback: string) => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = exit.cause.reasons.find(Cause.isFailReason);
  if (!failure) throw Cause.squash(exit.cause);
  throw new Error(failure.error.message.trim() || fallback);
};

const configuration = async (context: AuthSupportContext) => {
  const stored = await context.settings.read("mem");
  const settings = decodeSettings(stored?.configuration ?? {});
  return {
    baseUrl: settings.baseUrl,
    apiKey: "",
    hasApiKey: Boolean((await context.store.read("mem"))?.accessToken),
    clearApiKey: false,
    headers: JSON.stringify(settings.headers ?? {}, null, 2),
    model: settings.model,
    thinking: settings.thinking ?? "default",
  };
};

export const memAuthSupport: AuthSupport = {
  fields: [
    {
      path: ["baseUrl"],
      label: "API base URL",
      description: "OpenAI-compatible endpoint, including /v1. MEM_BASE_URL takes precedence.",
      type: "text",
    },
    {
      path: ["apiKey"],
      label: "API key (optional)",
      description: "Leave empty to keep the saved key. MEM_API_KEY takes precedence.",
      type: "password",
      storedPath: ["hasApiKey"],
    },
    { path: ["clearApiKey"], label: "Delete saved API key", type: "boolean" },
    {
      path: ["headers"],
      label: "Additional headers (optional JSON)",
      description: 'Example: {"X-API-Version":"2026-01"}. API key overrides Authorization.',
      type: "json",
    },
    {
      path: ["model"],
      label: "Summary model",
      description: "Enter a model ID or load the available models from this endpoint.",
      type: "text",
      optionsSource: {
        label: "Load models",
        dependencies: [["baseUrl"], ["apiKey"], ["clearApiKey"], ["headers"]],
      },
    },
    {
      path: ["thinking"],
      label: "Reasoning",
      type: "select",
      options: [
        { value: "default", label: "Provider default" },
        { value: "enabled", label: "Enabled" },
        { value: "disabled", label: "Disabled" },
      ],
    },
  ],
  configuration,
  configure: async (context, value) => {
    const { settings, apiKey, clearApiKey } = decodeInput(value);
    await context.settings.withLock("mem", () =>
      context.store.withLock("mem", async () => {
        if (apiKey) await context.store.write("mem", { accessToken: apiKey });
        else if (clearApiKey) await context.store.delete("mem");
        await context.settings.write("mem", {
          configuration: {
            model: settings.model,
            baseUrl: settings.baseUrl,
            thinking: settings.thinking ?? "default",
            headers: settings.headers ?? {},
          },
        });
      }),
    );
  },
  loadOptions: async (context, input) => {
    if (input.path.length !== 1 || input.path[0] !== "model")
      throw new UsageError("Unknown Mem settings field.");
    const settings = await draftSettings(context, input.configuration);
    const models = await run(listModels(settings, context.env), "Could not load models.");
    return models.map((model) => ({ value: model, label: model }));
  },
  testConfiguration: async (context, value) => {
    const result = await run(
      testConfiguration(await draftSettings(context, value), context.env),
      "Could not test the summary model.",
    );
    return {
      message: result.text,
      durationMs: result.durationMs,
      details: [
        { label: "Model", value: result.model },
        { label: "Reasoning", value: result.thinking },
        {
          label: "Input tokens",
          value: result.usageKnown ? String(result.inputTokens) : "Unknown",
        },
        {
          label: "Output tokens",
          value: result.usageKnown ? String(result.outputTokens) : "Unknown",
        },
        { label: "System prompt sent", value: result.systemPrompt, code: true },
      ],
      notice: "The response alone cannot confirm whether the server applied the Reasoning option.",
    };
  },
  status: async () => [],
  login: async () => {
    throw new UsageError("Mem uses a configured summary endpoint, without browser login.");
  },
  logout: async () => {
    throw new UsageError("Use Delete saved API key in Mem settings.");
  },
  resolve: async () => undefined,
  identity: async () => ({ service: "mem" }),
};
