import type { RoundtripOptions } from "../domain/options";
import { requestKey, resultData, resultOf } from "../domain/result";
import { characterErrorRate } from "../domain/textdiff";
import type { FishPorts, FishWorkflows, WorkflowOutcome } from "./ports";
import { createSpeech, readInput } from "./speech";
import { createTranscribe } from "./transcribe";

export const createWorkflows = (ports: FishPorts): FishWorkflows => {
  const tts = createSpeech(ports);
  const speakText = createSpeech(ports, false);
  const transcribe = createTranscribe(ports);
  const roundtrip = async (
    input: string,
    options: RoundtripOptions = {},
  ): Promise<WorkflowOutcome> => {
    if (options.output && !/\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i.test(options.output))
      throw new Error("Unsupported audio output extension.");
    if (options.maxCer !== undefined && (!Number.isFinite(options.maxCer) || options.maxCer < 0))
      throw new Error("maxCer must be a finite nonnegative number.");
    const expected = await readInput(ports, input, options.file);
    if (!expected.trim()) throw new Error("Text is empty.");
    let audio = options.audio;
    let credits = 0;
    if (!audio) {
      const speech = await speakText(expected, { ...options, file: undefined });
      if (speech.result.isError || options.estimate || options.dryRun) return speech;
      const data = resultData(speech.result);
      credits = typeof data.credits_charged === "number" ? data.credits_charged : 0;
      if (options.output) audio = `@${options.output}`;
      else if (typeof data.audio_url === "string") audio = data.audio_url;
      else {
        const path = ports.cachePath(
          requestKey({
            tool: "roundtrip-audio",
            expected,
            voice: options.voice_id,
            language: options.language,
          }),
        );
        const saved = await ports.saveAudio(speech.result, path);
        audio = `@${saved ?? path}`;
      }
    }
    const source = /^https:\/\//i.test(audio) || audio.startsWith("@") ? audio : `@${audio}`;
    const transcription = await transcribe(source, {
      model: options.model,
      language: options.language,
      estimate: options.estimate,
      dryRun: options.dryRun,
    });
    if (transcription.result.isError || options.estimate || options.dryRun) return transcription;
    const data = resultData(transcription.result);
    if (typeof data.text !== "string") throw new Error("Transcription has no text.");
    const cer = characterErrorRate(expected, data.text);
    const passed = options.maxCer === undefined || cer <= options.maxCer;
    return {
      result: resultOf({
        expected,
        heard: data.text,
        cer,
        passed,
        audio,
        credits_charged: credits + (typeof data.credits === "number" ? data.credits : 0),
      }),
      ...(passed ? {} : { exitCode: 1 }),
    };
  };
  return { tts, script: tts, transcribe, roundtrip };
};
export type { FishPorts, FishWorkflows, JournalEntry, WorkflowOutcome } from "./ports";
export type { SpeechOptions, TranscribeOptions, RoundtripOptions } from "../domain/options";
