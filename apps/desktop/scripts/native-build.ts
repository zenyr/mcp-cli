import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../../cli/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "mcp-desktop-build-"));
const run = async (args: string[]) => {
  const child = Bun.spawn(args, { cwd: desktop, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`빌드 명령에 실패했습니다: ${args[0]}`);
};
try {
  const name = process.platform === "win32" ? "mcp-cli.exe" : "mcp-cli";
  const binary = join(directory, name);
  await run([process.execPath, join(cli, "scripts/build.ts"), binary]);
  await run([process.execPath, "scripts/default-command.ts", "--packaged"]);
  await run([process.execPath, "scripts/icons.ts"]);
  await run([process.execPath, "scripts/sounds.ts"]);
  await run(["tinyjs", "build"]);
  await copyFile(binary, join(desktop, "dist", name));
  await chmod(join(desktop, "dist", name), 0o755);
  if (process.platform === "darwin") {
    const app = join(desktop, "dist/MCP CLI.app");
    await copyFile(binary, join(app, "Contents/MacOS", name));
    await chmod(join(app, "Contents/MacOS", name), 0o755);
    await run(["codesign", "--force", "--deep", "--sign", "-", app]);
    await run(["codesign", "--verify", "--deep", "--strict", app]);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
