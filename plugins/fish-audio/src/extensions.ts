import type { ExtensionCommand, ServiceExtensions } from "@mcp-cli/core";
import { normalizeArgv } from "./adapters/cli/normalize";
import { runWorkflow } from "./adapters/cli/run";
import { workflowSchema, type WorkflowName } from "./adapters/cli/schema";
const command = (name: WorkflowName, summary: string, examples: string[]): ExtensionCommand => ({
  path: [name],
  kind: name === "tts" || name === "stt" ? "alias" : "workflow",
  ...(name === "tts"
    ? { tool: "text_to_speech" }
    : name === "stt"
      ? { tool: "speech_to_text" }
      : {}),
  summary,
  examples,
  details:
    "Accepts one positional value, --file, or - for stdin. --json preserves the MCP result envelope.",
  rules: [
    "All remote calls use the shared runtime validation and repeat guard.",
    "Use --yes to approve generation in a noninteractive run.",
    "Interrupted generation retains a durable journal; pending outcomes require reconciliation.",
  ],
  inputSchema: workflowSchema(name),
  run: (input, context) => runWorkflow(name, input, context),
});
export const extensions: ServiceExtensions = {
  normalizeArgv,
  commands: [
    command("tts", "Generate speech and optionally save audio", [
      "tts '안녕하세요' --voice <id> -o hello.wav -y",
      "tts --file script.txt -o narration.mp3 --estimate",
    ]),
    command("stt", "Transcribe an HTTPS URL or local audio file", [
      "stt --file meeting.wav -o meeting.txt --speakers",
      "stt https://example.com/audio.mp3 --model flash",
    ]),
    command("script", "Generate, cache and join a multi-chunk script", [
      "script --file story.txt -o story.m4a --yes --max-credits 5000",
    ]),
    command("roundtrip", "Generate speech, transcribe and compare pronunciation", [
      "roundtrip '피시 오디오' --language ko --yes",
      "roundtrip --file story.txt --audio story.wav --fail-over 0.05",
    ]),
  ],
};
