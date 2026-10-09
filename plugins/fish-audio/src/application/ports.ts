import type { ToolCaller, ToolResult } from "@mcp-cli/core";
import type { RoundtripOptions, SpeechOptions, TranscribeOptions } from "../domain/options";

export type JournalEntry =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "failed"; input: Record<string, unknown>; result: ToolResult }
  | { status: "generated"; input: Record<string, unknown>; result: ToolResult }
  | { status: "ready"; input: Record<string, unknown>; result: ToolResult; path: string };

export interface FishPorts {
  callTool: ToolCaller;
  readText: (path: string) => Promise<string>;
  readStdin: () => Promise<string>;
  /** Saves to the requested durable cache path and returns the actual durable path. */
  saveAudio: (result: ToolResult, path: string) => Promise<string | void>;
  joinAudio: (paths: string[], path: string) => Promise<void>;
  ensureConverter: () => Promise<void>;
  store: {
    get: (key: string) => Promise<JournalEntry | undefined>;
    put: (key: string, entry: JournalEntry) => Promise<void>;
  };
  confirm: (message: string) => Promise<boolean>;
  cancelled: () => boolean;
  cachePath: (key: string) => string;
  copyAudio: (source: string, destination: string) => Promise<void>;
  writeText: (path: string, text: string) => Promise<void>;
  /** Validates local audio and returns an @path reference for guarded runtime upload. */
  prepareAudioReference: (path: string) => Promise<string>;
  audioIdentity: (reference: string) => Promise<string>;
}
export type WorkflowOutcome = { result: ToolResult; exitCode?: number };
export interface FishWorkflows {
  tts: (input: string, options?: SpeechOptions) => Promise<WorkflowOutcome>;
  script: (input: string, options?: SpeechOptions) => Promise<WorkflowOutcome>;
  transcribe: (input: string, options?: TranscribeOptions) => Promise<WorkflowOutcome>;
  roundtrip: (input: string, options?: RoundtripOptions) => Promise<WorkflowOutcome>;
}
