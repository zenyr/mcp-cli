import { fileRepeatGuard } from "@mcp-cli/auth";
import { UsageError, type RepeatGuard } from "@mcp-cli/core";

const DEFAULT_WINDOW_SECONDS = 300;

/** `MCP_CLI_REPEAT_WINDOW` sets the window in seconds; 0 turns the guard off. */
export const defaultRepeatGuard = (
  env: Record<string, string | undefined>,
): RepeatGuard | undefined => {
  const raw = env.MCP_CLI_REPEAT_WINDOW;
  const seconds = raw === undefined || raw === "" ? DEFAULT_WINDOW_SECONDS : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new UsageError("MCP_CLI_REPEAT_WINDOW must be a non-negative number of seconds");
  return seconds ? fileRepeatGuard({ windowMs: seconds * 1000, env }) : undefined;
};
