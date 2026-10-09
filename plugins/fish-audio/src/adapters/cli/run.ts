import { isRecord, UsageError, type ExtensionContext } from "@mcp-cli/core";
import { createWorkflows } from "../../application/workflows";
import type { WorkflowOutcome } from "../../application/ports";
import type { SpeechOptions, TranscribeOptions } from "../../domain/options";
import { createPorts } from "../ports";
import { remoteProperties, type WorkflowName } from "./schema";

const text = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new UsageError(`${key} must be a string`);
  return value;
};
const number = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new UsageError(`${key} must be a finite number`);
  return value;
};
const boolean = (input: Record<string, unknown>, key: string): boolean | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new UsageError(`${key} must be a boolean`);
  return value;
};
export const runWorkflow = async (
  name: WorkflowName,
  input: Record<string, unknown>,
  context: ExtensionContext,
): Promise<WorkflowOutcome> => {
  const field = name === "stt" ? "audio_url" : "text";
  let value = text(input, field);
  const file = text(input, "file");
  if (value !== undefined && file !== undefined)
    throw new UsageError("Use a positional value or --file, not both");
  if (value === undefined && file === undefined)
    throw new UsageError("Pass a positional value, - for stdin, or --file");
  const output = text(input, "output");
  if (name === "script" && !output) throw new UsageError("script requires --output");
  const controller = new AbortController();
  const stop = (): void => {
    if (controller.signal.aborted) {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
      process.kill(process.pid, "SIGTERM");
      return;
    }
    controller.abort();
    context.io.writeError(
      "Cancellation requested; draining active calls. Send a second signal to exit immediately and retain the recovery lock.",
    );
  };
  const ports = createPorts(context, output, controller.signal);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    if (name === "stt" && value === "-") value = (await ports.readStdin()).trim();
    if (
      name === "stt" &&
      value !== undefined &&
      !value.startsWith("@") &&
      !/^https:\/\//i.test(value)
    )
      throw new UsageError("Expected an HTTPS audio URL, @path or --file");
    const speech: SpeechOptions = {
      output,
      file,
      yes: boolean(input, "yes"),
      estimate: boolean(input, "estimate"),
      dryRun: boolean(input, "dry_run"),
      chunkChars: number(input, "chunk_chars"),
      maxCredits: number(input, "max_credits"),
      concurrency: number(input, "concurrency"),
      keepParts: boolean(input, "keep_parts"),
      voice_id: text(input, "voice_id"),
      language: text(input, "language"),
      toolInput: Object.fromEntries(
        Object.keys(remoteProperties("text_to_speech"))
          .filter((key) => key !== "text" && input[key] !== undefined)
          .map((key) => [key, input[key]]),
      ),
    };
    const format = text(input, "format");
    if (format !== undefined && format !== "txt" && format !== "json")
      throw new UsageError("Transcript format must be txt or json");
    if (name === "stt" && output && !/\.(txt|json)$/i.test(output))
      throw new UsageError("Transcript output must use .txt or .json; timestamps are unavailable");
    const transcription: TranscribeOptions = {
      output,
      file,
      format,
      speakers: boolean(input, "speakers"),
      model: text(input, "model"),
      language: text(input, "language"),
      estimate: speech.estimate,
      dryRun: speech.dryRun,
    };
    await ports.acquire();
    const workflows = createWorkflows(ports);
    if (name === "stt") {
      const outcome = await workflows.transcribe(value ?? "", transcription);
      const data = outcome.result.structuredContent;
      if (
        input.text === true &&
        !context.json &&
        !outcome.result.isError &&
        isRecord(data) &&
        typeof data.rendered === "string"
      )
        return {
          ...outcome,
          result: { ...outcome.result, content: [{ type: "text", text: data.rendered.trimEnd() }] },
        };
      return outcome;
    }
    if (name === "roundtrip")
      return await workflows.roundtrip(value ?? "", {
        ...speech,
        audio: text(input, "audio"),
        model: text(input, "model"),
        maxCer: number(input, "max_cer"),
      });
    return await workflows[name](value ?? "", speech);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await ports.release();
  }
};
