import { createHash } from "node:crypto";
import { canonicalize, type CallRecord, type CommandSpec } from "@mcp-cli/core";

// Read-only and idempotent tools are safe to repeat; tools without annotations are guarded.
export const guardsRepeats = (command: CommandSpec): boolean =>
  command.annotations?.readOnlyHint !== true && command.annotations?.idempotentHint !== true;

// The credential is part of the key because posting as a user and as a bot are different actions.
export const callKey = (
  tool: string,
  input: Record<string, unknown>,
  credential?: string,
  workspace?: string,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          tool,
          input,
          ...(credential && { credential }),
          ...(workspace && { workspace }),
        }),
      ),
    )
    .digest("hex");

export const repeatMessage = (command: string, earlier: CallRecord, now: number): string => {
  const time = new Date(earlier.at).toLocaleTimeString();
  const ago = Math.max(0, Math.round((now - earlier.at) / 1000));
  const outcome =
    earlier.status === "ok"
      ? `the same input already succeeded at ${time} (${ago}s ago)`
      : `the same input started at ${time} (${ago}s ago) and its outcome is unknown; check it first`;
  return `Refusing to repeat ${command}: ${outcome}. Pass --allow-repeat to run it again.`;
};
