import type { ToolSession } from "@mcp-cli/core";
import type { RuntimeDependencies } from "./index";

export type RecordedCall = { name: string; input: Record<string, unknown> };

/** Rejects any access a plugin test does not expect. */
export const unavailable = async (): Promise<never> => {
  throw new Error("Unexpected catalog or file access");
};

/** Offline runtime ports that record tool calls and output for plugin command tests. */
export const recordingPorts = (): {
  calls: RecordedCall[];
  output: string[];
  ports: RuntimeDependencies;
} => {
  const calls: RecordedCall[] = [];
  const output: string[] = [];
  const session: ToolSession = {
    listTools: unavailable,
    listResources: unavailable,
    listResourceTemplates: unavailable,
    readResource: unavailable,
    listPrompts: unavailable,
    getPrompt: unavailable,
    callTool: async (name, input) => {
      calls.push({ name, input });
      return { content: [{ type: "text", text: "ok" }] };
    },
    close: async () => {},
  };
  return {
    calls,
    output,
    ports: {
      open: async () => session,
      io: {
        write: (text) => {
          output.push(text);
        },
        writeError: unavailable,
        readFile: unavailable,
        readBytes: unavailable,
        readStdin: unavailable,
      },
    },
  };
};
