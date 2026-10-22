import { chmod, copyFile, cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installBuild } from "./graceful-update";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../../cli/", import.meta.url));
const lock = join(desktop, ".native-build.lock");
await mkdir(lock).catch(() => {
  throw new Error("다른 네이티브 빌드가 실행 중이거나 빌드 잠금이 남아 있습니다.");
});
let directory: string | undefined;
const run = async (args: string[], cwd = desktop) => {
  const child = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`빌드 명령에 실패했습니다: ${args[0]}`);
};
try {
  directory = await mkdtemp(join(dirname(desktop), ".desktop-build-"));
  await cp(desktop, directory, {
    recursive: true,
    filter: (path) =>
      path === desktop ||
      (!["node_modules", "dist", ".build", ".native-build.lock"].includes(basename(path)) &&
        !basename(path).startsWith(".env")),
  });
  await symlink(join(desktop, "node_modules"), join(directory, "node_modules"), "dir");
  const name = process.platform === "win32" ? "mcp-cli.exe" : "mcp-cli";
  const binary = join(directory, name);
  await run([process.execPath, join(cli, "scripts/build.ts"), binary]);
  await run([process.execPath, "scripts/default-command.ts", "--packaged"], directory);
  await run([process.execPath, "scripts/icons.ts"], directory);
  await run([process.execPath, "scripts/sounds.ts"], directory);
  await run(["tinyjs", "build"], directory);
  await copyFile(binary, join(directory, "dist", name));
  await chmod(join(directory, "dist", name), 0o755);
  if (process.platform === "darwin") {
    const app = join(directory, "dist/MCP CLI.app");
    await copyFile(binary, join(app, "Contents/MacOS", name));
    await chmod(join(app, "Contents/MacOS", name), 0o755);
    await run(["codesign", "--force", "--deep", "--sign", "-", app]);
    await run(["codesign", "--verify", "--deep", "--strict", app]);
  }
  await installBuild(join(directory, "dist"), join(desktop, "dist"));
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
  await rm(lock, { recursive: true, force: true });
}
