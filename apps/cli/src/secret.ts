import { UsageError } from "@mcp-cli/core";

const ENTER = new Set(["\r", "\n"]);
const CTRL_C = "\u0003";
const BACKSPACE = new Set(["\u007f", "\b"]);

/** Reads piped stdin as is, or prompts on a terminal without echoing the typed key. */
export const readSecret = async (prompt: string): Promise<string> => {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Bun.stdin.text();
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (settle: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      settle();
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (ENTER.has(char)) return finish(() => resolve(value));
        if (char === CTRL_C) return finish(() => reject(new UsageError("Login cancelled")));
        value = BACKSPACE.has(char) ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
};
