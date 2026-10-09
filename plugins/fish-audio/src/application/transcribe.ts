import { dispatch } from "./dispatch";
import type { TranscribeOptions } from "../domain/options";
import { requestKey, resultData, resultOf } from "../domain/result";
import { parseTranscript, renderTranscript, transcriptFormatForPath } from "../domain/transcript";
import type { FishPorts, JournalEntry, WorkflowOutcome } from "./ports";
import { checkCancelled } from "./speech";

export const createTranscribe =
  (ports: FishPorts) =>
  async (source: string, options: TranscribeOptions = {}): Promise<WorkflowOutcome> => {
    if (source === "-" && !options.file) source = (await ports.readStdin()).trim();
    const format = options.format ?? transcriptFormatForPath(options.output ?? "transcript.txt");
    if (options.output) transcriptFormatForPath(options.output);
    const local = options.file ?? (source.startsWith("@") ? source.slice(1) : undefined);
    if (!local && !/^https:\/\//i.test(source))
      throw new Error("Expected HTTPS audio URL, @path or --file.");
    const input = {
      ...(options.language ? { language: options.language } : {}),
      ...(options.model ? { model: options.model } : {}),
    };
    if (options.estimate || options.dryRun)
      return {
        result: resultOf({
          tool: "speech_to_text",
          source,
          input,
          estimate: true,
          credits: "unknown until duration is measured",
        }),
      };
    checkCancelled(ports);
    const url = local ? await ports.prepareAudioReference(local) : source;
    if (!/^https:\/\//i.test(url) && !url.startsWith("@"))
      throw new Error("Audio must have an HTTPS URL or @path reference.");
    checkCancelled(ports);
    const callInput = { ...input, audio_url: url };
    const key = requestKey({
      tool: "speech_to_text",
      ...input,
      audio_url: await ports.audioIdentity(url),
    });
    let stored = await ports.store.get(key);
    if (stored?.status === "pending")
      throw new Error("Unknown STT outcome in pending journal; reconcile before retrying.");
    if (!stored || stored.status === "failed") {
      const response = await dispatch(ports, key, "speech_to_text", callInput);
      const entry: JournalEntry = {
        status: response.isError ? "failed" : "generated",
        input: callInput,
        result: response,
      };
      await ports.store.put(key, entry);
      stored = entry;
    }
    if (!stored || stored.status === "pending") throw new Error("No durable STT response.");
    const result = stored.result;
    if (result.isError) return { result, exitCode: 1 };
    const transcript = parseTranscript(resultData(result));
    const rendered = renderTranscript(transcript, format, options.speakers);
    if (options.output) await ports.writeText(options.output, rendered);
    return {
      result: resultOf({
        ...transcript,
        rendered,
        ...(options.output ? { file: options.output } : {}),
      }),
    };
  };
