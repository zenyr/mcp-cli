export type SpeechOptions = {
  output?: string;
  file?: string;
  yes?: boolean;
  estimate?: boolean;
  dryRun?: boolean;
  chunkChars?: number;
  maxCredits?: number;
  concurrency?: number;
  keepParts?: boolean;
  voice_id?: string;
  language?: string;
  toolInput?: Record<string, unknown>;
};
export type TranscribeOptions = {
  output?: string;
  file?: string;
  format?: "txt" | "json";
  speakers?: boolean;
  model?: string;
  language?: string;
  estimate?: boolean;
  dryRun?: boolean;
};
export type RoundtripOptions = SpeechOptions & {
  audio?: string;
  model?: string;
  maxCer?: number;
};
