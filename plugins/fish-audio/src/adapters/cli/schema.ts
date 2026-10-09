import { isRecord, type JsonSchema } from "@mcp-cli/core";
import snapshot from "../../tools.json";
export type WorkflowName = "tts" | "stt" | "script" | "roundtrip";
export const remoteProperties = (name: string): Record<string, unknown> => {
  const schema = snapshot.tools.find((tool) => tool.name === name)?.inputSchema;
  return schema && isRecord(schema.properties) ? schema.properties : {};
};
const string = (description: string): JsonSchema => ({ type: "string", description });
const boolean = (description: string): JsonSchema => ({ type: "boolean", description });
const speech = {
  yes: boolean("Approve generation without a terminal prompt"),
  max_credits: { type: "number", minimum: 0, description: "Maximum credits" },
  concurrency: { type: "integer", minimum: 1, maximum: 4 },
  chunk_chars: { type: "integer", minimum: 1, maximum: 2000 },
  keep_parts: boolean("Compatibility option; completed chunks are always retained"),
};
export const workflowSchema = (name: WorkflowName): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: {
    ...remoteProperties(name === "stt" ? "speech_to_text" : "text_to_speech"),
    file: string(name === "stt" ? "Local audio file to upload" : "Read text from this file"),
    output: string(
      name === "stt"
        ? "Save transcript as .txt or .json"
        : "Save audio; extension selects the format",
    ),
    dry_run: boolean("Validate and show the plan without paid calls"),
    estimate: boolean("Show the estimated cost without generation"),
    ...(name === "stt"
      ? {
          format: { type: "string", enum: ["txt", "json"] },
          speakers: boolean("Label speaker turns"),
          text: boolean("Render transcript text"),
        }
      : speech),
    ...(name === "roundtrip"
      ? {
          audio: string("Existing HTTPS audio URL or local file"),
          model: remoteProperties("speech_to_text").model,
          max_cer: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Exit 1 above this character error rate",
          },
        }
      : {}),
  },
});
