import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const daemonDirectory = (env: Record<string, string | undefined>) =>
  env.MCP_CLI_DAEMON_DIR || join(homedir(), ".mcp-cli", "daemon");
export const daemonSocket = (directory: string, platform: NodeJS.Platform = process.platform) => {
  const identity = createHash("sha256").update(directory).digest("hex").slice(0, 24);
  return platform === "win32"
    ? String.raw`\\.\pipe\mcp-cli-${identity}`
    : join(directory, "daemon.sock");
};
