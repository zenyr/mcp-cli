export type Segment = { speaker?: number; text: string };
export type Transcript = {
  text: string;
  language?: string;
  durationSeconds?: number;
  model?: string;
  credits?: number;
  segments: Segment[];
};
export type TranscriptFormat = "txt" | "json";

const SPEAKER = /<\|speaker:(\d+)\|>/g;

/** Splits STT text on `<|speaker:N|>` tags into speaker turns. */
export const parseTranscript = (data: Record<string, unknown> | undefined): Transcript => {
  if (typeof data?.text !== "string") throw new Error("Transcription result has no text.");
  const source = data.text;
  const segments: Segment[] = [];
  let speaker: number | undefined;
  let cursor = 0;
  const push = (end: number) => {
    const piece = source.slice(cursor, end).trim();
    if (piece) segments.push(speaker === undefined ? { text: piece } : { speaker, text: piece });
  };
  for (const match of data.text.matchAll(SPEAKER)) {
    push(match.index);
    speaker = Number(match[1]);
    cursor = match.index + match[0].length;
  }
  push(data.text.length);
  const number = (value: unknown) => (typeof value === "number" ? value : undefined);
  return {
    text: segments.map((segment) => segment.text).join(" "),
    ...(typeof data.language === "string" ? { language: data.language } : {}),
    ...(number(data.duration_seconds) !== undefined
      ? { durationSeconds: number(data.duration_seconds) }
      : {}),
    ...(typeof data.model === "string" ? { model: data.model } : {}),
    ...(number(data.credits_charged) !== undefined
      ? { credits: number(data.credits_charged) }
      : {}),
    segments,
  };
};

/** Transcript format for an output path; subtitle formats are rejected because the server returns no timestamps. */
export const transcriptFormatForPath = (path: string): TranscriptFormat => {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "srt" || extension === "vtt")
    throw new Error(
      `.${extension} needs timestamps, which Fish Audio STT does not return. Use .txt or .json.`,
    );
  return extension === "json" ? "json" : "txt";
};

export const renderTranscript = (
  transcript: Transcript,
  format: TranscriptFormat,
  speakers = false,
): string => {
  if (format === "json") return `${JSON.stringify(transcript, null, 2)}\n`;
  if (!speakers || transcript.segments.every((segment) => segment.speaker === undefined))
    return `${transcript.text}\n`;
  return (
    transcript.segments
      .map(
        (segment) =>
          `${segment.speaker === undefined ? "" : `Speaker ${segment.speaker + 1}: `}${segment.text}`,
      )
      .join("\n") + "\n"
  );
};
