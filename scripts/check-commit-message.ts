export {};

const path = process.argv[2];
if (!path) throw new Error("A commit message file is required.");
const message = (await Bun.file(path).text()).split("\n")[0] ?? "";
const conventional =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-z0-9][a-z0-9./_-]*\)!?: \S.*$/;
if (!conventional.test(message)) {
  console.error("Use a scoped conventional commit: feat(scope): description");
  process.exitCode = 1;
}
