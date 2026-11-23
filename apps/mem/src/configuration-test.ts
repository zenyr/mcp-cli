import { Duration, Effect, Schema } from "effect";
import { createCompressor, SUMMARY_PROMPT } from "./compressor";
import type { Compression, Env, Settings } from "./types";
import { isRecord } from "./values";

export type ConfigurationTestResult = {
  model: string;
  thinking: "default" | "enabled" | "disabled";
  systemPrompt: string;
  text: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
};

export class ConfigurationTestError extends Schema.TaggedError<ConfigurationTestError>()(
  "ConfigurationTestError",
  { code: Schema.String, message: Schema.String },
) {}

export const CONFIGURATION_TEST_SAMPLE: Compression = {
  source: [
    "user: Deploy the API to staging first; production waits for the load test.",
    "tool: Staging deploy finished at revision 42 with all health checks passing.",
    "user: Cancel the Friday production release and keep the feature flag off.",
  ].join("\n"),
  merge: false,
  targetBytes: 256,
};

const UNKNOWN_FAILURE = "Could not test the summary model. Check the address and authentication.";

// Only coded errors from Mem's own `fail` carry messages safe to show.
const toTestError = (error: unknown): ConfigurationTestError => {
  if (!isRecord(error) || typeof error.code !== "string" || !isRecord(error.details))
    return new ConfigurationTestError({ code: "MODEL_TEST_FAILED", message: UNKNOWN_FAILURE });
  const status = error.details.status;
  const message =
    typeof error.message === "string" && error.message ? error.message : UNKNOWN_FAILURE;
  return new ConfigurationTestError({
    code: error.code,
    message: typeof status === "number" ? `${message} (HTTP ${status})` : message,
  });
};

/** Sends the fixed sample through the production compressor without saving anything. */
export const testConfiguration = (settings: Settings, env: Env = {}) =>
  Effect.gen(function* () {
    if (!settings.baseUrl || !settings.model)
      return yield* new ConfigurationTestError({
        code: "SUMMARY_NOT_CONFIGURED",
        message: "Enter the API base URL and summary model first.",
      });
    const [duration, result] = yield* Effect.timed(
      Effect.tryPromise({
        try: (signal) => createCompressor(settings, env, signal)(CONFIGURATION_TEST_SAMPLE),
        catch: toTestError,
      }),
    );
    const diagnostic: ConfigurationTestResult = {
      model: result.model,
      thinking: settings.thinking ?? "default",
      systemPrompt: SUMMARY_PROMPT,
      text: result.text,
      durationMs: Math.round(Duration.toMillis(duration)),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      usageKnown: result.usageKnown === true,
    };
    return diagnostic;
  });
