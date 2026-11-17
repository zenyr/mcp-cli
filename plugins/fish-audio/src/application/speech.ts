import { dispatch } from "./dispatch";
import type { SpeechOptions } from "../domain/options";
import { creditCharge, object, requestKey, resultData, resultOf } from "../domain/result";
import { scriptChunks, utf8Bytes } from "../domain/script";
import type { FishPorts, JournalEntry, WorkflowOutcome } from "./ports";
import { runningTask, settleSpeechTask } from "./speech-task";

export const readInput = async (
  ports: FishPorts,
  input: string,
  file?: string,
): Promise<string> => {
  if (file) return ports.readText(file);
  if (input === "-") return ports.readStdin();
  if (input.startsWith("@")) return ports.readText(input.slice(1));
  return input;
};
const voiceId = (entry?: JournalEntry): string | undefined => {
  if (!entry || entry.status === "pending" || entry.status === "failed") return undefined;
  const voice = object(resultData(entry.result).voice);
  return typeof voice?.id === "string" ? voice.id : undefined;
};
const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
export const checkCancelled = (ports: FishPorts): void => {
  if (ports.cancelled()) throw new Error("Workflow cancelled; journal retained for resume.");
};

export const createSpeech =
  (ports: FishPorts, resolveInput = true) =>
  async (source: string, options: SpeechOptions = {}): Promise<WorkflowOutcome> => {
    if (
      options.output &&
      !/\.(mp3|wav|wave|ogg|oga|opus|flac|m4a|mp4|aac|webm)$/i.test(options.output)
    )
      throw new Error("Unsupported audio output extension.");
    const concurrency = options.concurrency ?? 2;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
      throw new Error("Concurrency must be an integer from 1 to 4.");
    if (options.maxCredits !== undefined && positive(options.maxCredits) === undefined)
      throw new Error("maxCredits must be a finite nonnegative number.");
    const chunkChars = options.chunkChars ?? 2000;
    if (!Number.isInteger(chunkChars) || chunkChars < 1)
      throw new Error("chunkChars must be a positive integer.");
    const text = resolveInput ? await readInput(ports, source, options.file) : source;
    if (!text.trim()) throw new Error("Text is empty.");
    checkCancelled(ports);
    const input = {
      ...options.toolInput,
      ...(options.language ? { language: options.language } : {}),
      ...(options.voice_id ? { voice_id: options.voice_id } : {}),
    };
    const accountResult = await ports.callTool("get_credit_balance", {});
    const account = accountResult.isError ? {} : resultData(accountResult);
    const maxBytes = positive(account.tts_max_text_bytes_per_call) ?? 500;
    if (maxBytes < 1) throw new Error("Account has no TTS byte allowance.");
    const texts = scriptChunks(text, {
      maxChars: Math.min(2000, chunkChars),
      maxBytes: Math.floor(maxBytes),
    });
    const first = texts[0];
    if (first === undefined) throw new Error("Text is empty.");
    const firstInput = { ...input, text: first };
    const firstKey = requestKey(firstInput);
    const firstStored = await ports.store.get(firstKey);
    let voice = typeof input.voice_id === "string" ? input.voice_id : voiceId(firstStored);
    const request = (piece: string) =>
      piece === first
        ? firstInput
        : {
            ...input,
            text: piece,
            ...(voice ? { voice_id: voice } : {}),
          };
    let reservation = 0;
    let cached = 0;
    const unique = new Set<string>();
    for (const piece of texts) {
      const key = requestKey(request(piece));
      if (unique.has(key)) continue;
      unique.add(key);
      const stored = await ports.store.get(key);
      if (stored?.status === "pending")
        throw new Error(
          "Unknown TTS outcome in pending journal; find it with speech history before retrying.",
        );
      if (stored?.status === "ready" || stored?.status === "generated") cached++;
      else reservation += utf8Bytes(piece) * 2;
    }
    const balance = positive(account.package_balance);
    const available =
      balance === undefined ? undefined : balance + (positive(account.package_extra_balance) ?? 0);
    const ceiling = Math.min(options.maxCredits ?? Infinity, available ?? Infinity);
    const plan = {
      chunks: texts.length,
      unique_chunks: unique.size,
      cached_chunks: cached,
      estimated_credits: reservation,
      max_bytes_per_call: maxBytes,
      file: options.output,
    };
    if (options.estimate || options.dryRun)
      return { result: resultOf({ ...plan, estimate: true }) };
    if (reservation > ceiling)
      throw new Error(
        `Reserved ${reservation} credits exceeds maxCredits or account balance ${ceiling}.`,
      );
    if (texts.length > 1) {
      if (!options.output) throw new Error("Multiple chunks require an output path.");
      await ports.ensureConverter();
    }
    if (
      reservation > 0 &&
      !options.yes &&
      !(await ports.confirm(
        `Generate ${texts.length} chunks, reserving up to ${reservation} TTS credits?`,
      ))
    )
      return {
        result: { ...resultOf({ status: "confirmation_required", ...plan }), isError: true },
        exitCode: 1,
      };
    let spent = 0;
    let reserved = 0;
    const inFlight = new Map<
      string,
      Promise<Extract<JournalEntry, { status: "ready" | "generated" }>>
    >();
    const generate = async (
      piece: string,
    ): Promise<Extract<JournalEntry, { status: "ready" | "generated" }>> => {
      checkCancelled(ports);
      const callInput = request(piece);
      const key = requestKey(callInput);
      let stored = await ports.store.get(key);
      if (stored?.status === "ready") return stored;
      if (stored?.status === "pending")
        throw new Error(
          "Unknown TTS outcome in pending journal; find it with speech history before retrying.",
        );
      if (!stored || stored.status === "failed") {
        const budget = utf8Bytes(piece) * 2;
        if (spent + reserved + budget > ceiling)
          throw new Error("Credit reservation exceeds the remaining budget.");
        reserved += budget;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            checkCancelled(ports);
            const result = await dispatch(ports, key, "text_to_speech", callInput);
            if (result.isError === true) {
              await ports.store.put(key, { status: "failed", input: callInput, result });
              if (attempt === 1)
                throw new Error("TTS explicitly failed twice; completed chunks retained.");
              continue;
            }
            stored = { status: "generated", input: callInput, result };
            await ports.store.put(key, stored);
            spent += creditCharge(result, budget);
            break;
          }
        } finally {
          reserved -= budget;
        }
      }
      if (!stored || stored.status !== "generated")
        throw new Error("No generated response in journal.");
      const taskId = runningTask(stored.result);
      if (taskId) {
        const settled = await settleSpeechTask(ports, stored.result, taskId);
        if (settled.status === "failed") {
          await ports.store.put(key, {
            status: "failed",
            input: callInput,
            result: settled.result,
          });
          throw new Error(`Speech task ${taskId} failed and was refunded; run again to retry it.`);
        }
        stored = { status: "generated", input: callInput, result: settled.result };
        await ports.store.put(key, stored);
      }
      if (!options.output) return stored;
      const cachePath = ports.cachePath(key);
      const path = (await ports.saveAudio(stored.result, cachePath)) ?? cachePath;
      const ready: Extract<JournalEntry, { status: "ready" | "generated" }> = {
        ...stored,
        status: "ready",
        path,
      };
      await ports.store.put(key, ready);
      return ready;
    };
    const run = (piece: string) => {
      const key = requestKey(request(piece));
      const existing = inFlight.get(key);
      if (existing) return existing;
      const pending = generate(piece);
      inFlight.set(key, pending);
      return pending;
    };
    const initial = await run(first);
    voice ??= voiceId(initial);
    if (texts.length > 1 && !voice)
      throw new Error(
        "First TTS response did not identify a voice; no later chunks were generated.",
      );
    const results: Array<Extract<JournalEntry, { status: "ready" | "generated" }>> = [initial];
    let next = 1;
    let stopped = false;
    let failure: unknown;
    const worker = async () => {
      while (!stopped && next < texts.length) {
        const index = next++;
        const piece = texts[index];
        if (piece === undefined) return;
        try {
          results[index] = await run(piece);
        } catch (error) {
          stopped = true;
          failure ??= error;
        }
      }
    };
    await Promise.allSettled(Array.from({ length: concurrency }, worker));
    if (failure !== undefined) throw failure;
    checkCancelled(ports);
    if (spent > ceiling)
      throw new Error("Server charge exceeded the reserved budget; remaining work stopped.");
    if (options.output) {
      const paths = results.map((entry) => {
        if (entry.status !== "ready") throw new Error("Audio cache is not ready.");
        return entry.path;
      });
      const firstPath = paths[0];
      if (paths.length === 1 && firstPath) await ports.copyAudio(firstPath, options.output);
      else await ports.joinAudio(paths, options.output);
    }
    if (!options.output) return { result: initial.result };
    return {
      result: resultOf({
        ...resultData(initial.result),
        file: options.output,
        chunks: texts.length,
        cached_chunks: cached,
        credits_charged: spent,
        voice: { id: voice },
      }),
    };
  };
