import { copyFile, cp, chmod, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../tinyjs.json";

if (process.platform !== "darwin") throw new Error("DMG distribution requires macOS.");
const desktop = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "mcp-cli-dmg-"));
const run = async (args: string[]) => {
  const child = Bun.spawn(args, { cwd: desktop, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`Distribution command failed: ${args[0]}`);
};

try {
  const build = join(directory, "build");
  await run([process.execPath, "scripts/native-build.ts", "--output", build]);
  const staging = join(directory, "volume");
  await mkdir(staging);
  await cp(join(build, "MCP CLI.app"), join(staging, "MCP CLI.app"), { recursive: true });
  await symlink("/Applications", join(staging, "Applications"));
  for (const file of ["READ ME.txt", "Allow MCP CLI.command"]) {
    await copyFile(join(desktop, "distribution", file), join(staging, file));
  }
  await chmod(join(staging, "Allow MCP CLI.command"), 0o755);
  const name = `MCP-CLI-${config.version}-macos-${process.arch}.dmg`;
  const image = join(directory, name);
  await run([
    "/usr/bin/hdiutil",
    "create",
    "-volname",
    "MCP CLI",
    "-srcfolder",
    staging,
    "-format",
    "UDZO",
    "-fs",
    "HFS+",
    image,
  ]);
  await run(["/usr/bin/hdiutil", "verify", image]);
  const output = join(desktop, "dist");
  await mkdir(output, { recursive: true });
  const temporary = join(output, `.${name}.${process.pid}`);
  try {
    await copyFile(image, temporary);
    await rename(temporary, join(output, name));
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`DMG: ${join(output, name)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
