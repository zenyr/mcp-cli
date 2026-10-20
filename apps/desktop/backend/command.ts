import { defaultCommand } from "./default-command";

export const cliCommand = async (app: DesktopApp): Promise<string[]> => {
  const saved = await app.store.get("cliCommand");
  if (Array.isArray(saved) && saved.length && saved.every((item) => typeof item === "string"))
    return saved;
  const entry = tjs.env.MCP_CLI_DESKTOP_ENTRY;
  if (entry) return [tjs.env.MCP_CLI_DESKTOP_BUN || "bun", entry];
  const name = tjs.env.OS === "Windows_NT" ? "mcp-cli.exe" : "mcp-cli";
  const binary = tjs.exePath.replace(/[/\\][^/\\]+$/, `/${name}`);
  try {
    if ((await tjs.stat(binary)).isFile) return [binary];
  } catch {
    /* Development builds use the source entry when no bundled executable exists. */
  }
  if (defaultCommand.length) return defaultCommand;
  throw new Error("앱에 포함된 실행 파일을 찾지 못했습니다. 앱을 다시 설치해 주세요.");
};
