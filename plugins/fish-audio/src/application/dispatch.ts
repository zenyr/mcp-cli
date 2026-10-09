import { CallNotStartedError, type ToolResult } from "@mcp-cli/core";
import { resultOf } from "../domain/result";
import type { FishPorts } from "./ports";

export const dispatch = async (
  ports: FishPorts,
  key: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<ToolResult> => {
  await ports.store.put(key, { status: "pending", input });
  try {
    return await ports.callTool(tool, input);
  } catch (error) {
    if (error instanceof CallNotStartedError)
      await ports.store.put(key, {
        status: "failed",
        input,
        result: { ...resultOf({ status: "not_started" }), isError: true },
      });
    throw error;
  }
};
