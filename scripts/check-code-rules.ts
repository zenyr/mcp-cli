import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const ignored = new Set(["node_modules", ".git", ".turbo", "dist", "coverage", "generated"]);
const collect = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name)) return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collect(path);
      return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) &&
        !path.endsWith(".generated.ts") &&
        entry.name !== "generated.ts"
        ? [path]
        : [];
    }),
  );
  return groups.flat();
};

const paths = process.argv.slice(2);
const files = paths.length ? paths : await collect(".");
let failures = 0;
for (const file of files) {
  if (
    file.split("/").includes("generated") ||
    file.endsWith(".generated.ts") ||
    file.endsWith("/generated.ts")
  )
    continue;
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) continue;
  const content = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const report = (node: ts.Node, message: string) => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    console.error(`${file}:${position.line + 1}:${position.character + 1}: ${message}`);
    failures += 1;
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)
    )
      report(node, "Use an arrow function.");
    if (ts.isNonNullExpression(node)) report(node, "Non-null assertions are prohibited.");
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, "Explicit any is prohibited.");
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.kind === ts.SyntaxKind.UnknownKeyword
    ) {
      report(node, "Assertions to unknown are prohibited.");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const exempt = /(?:\.test\.|\.spec\.|(?:^|\/)tests?\/|(?:^|\/)fixtures?\/)/.test(file);
  if (!exempt && content.split("\n").length > 350)
    console.warn(`${file}: exceeds the 350-line soft cap.`);
}
process.exitCode = failures ? 1 : 0;
