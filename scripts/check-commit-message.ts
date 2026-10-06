export {};

const path = process.argv[2];
if (!path) throw new Error("A commit message file is required.");
const subject =
  (await Bun.file(path).text())
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";
const conventional =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-z0-9][a-z0-9./_-]*\)!?: \S.*$/;
const gitAuthored = /^(?:Merge |Revert "|fixup! |squash! )/;
if (!conventional.test(subject) && !gitAuthored.test(subject)) {
  console.error("Use a scoped conventional commit: feat(scope): description");
  process.exitCode = 1;
}
