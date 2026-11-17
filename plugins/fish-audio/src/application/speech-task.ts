import type { ToolResult } from "@mcp-cli/core";
import { resultData, resultOf } from "../domain/result";
import type { FishPorts } from "./ports";

const maxWaitSeconds = 900;

const pollSeconds = (data: Record<string, unknown>): number => {
  const value = data.poll_after_seconds;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(60, Math.max(1, value)) : 5;
};

/** Returns the task id when text_to_speech answered with a charged background task instead of audio. */
export const runningTask = (result: ToolResult): string | undefined => {
  const data = resultData(result);
  return data.status === "running" && typeof data.task_id === "string" ? data.task_id : undefined;
};

export type SpeechTaskOutcome =
  | { status: "succeeded"; result: ToolResult }
  | { status: "failed"; result: ToolResult };

/** Polls get_speech until the task settles, keeping the original response's fields such as the voice. */
export const settleSpeechTask = async (
  ports: FishPorts,
  running: ToolResult,
  taskId: string,
): Promise<SpeechTaskOutcome> => {
  let waited = 0;
  let wait = pollSeconds(resultData(running));
  while (waited < maxWaitSeconds) {
    if (ports.cancelled()) throw new Error("Workflow cancelled; journal retained for resume.");
    await ports.delay(wait);
    waited += wait;
    const result = await ports.callTool("get_speech", { task_id: taskId });
    const data = resultData(result);
    if (data.status === "succeeded")
      return { status: "succeeded", result: resultOf({ ...resultData(running), ...data }) };
    if (result.isError === true)
      throw new Error(`Could not check speech task ${taskId}; run again later to resume it.`);
    if (data.status === "failed") return { status: "failed", result };
    wait = pollSeconds(data);
  }
  throw new Error(`Speech task ${taskId} is still running; run again later to resume it.`);
};
