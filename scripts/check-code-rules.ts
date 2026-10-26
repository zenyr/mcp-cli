import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

// Codegen must emit this marker as the first line of every generated file.
const GENERATED_MARKER = "// @generated";
const ignored = new Set(["node_modules", ".git", ".turbo", ".build", "dist", "coverage"]);
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const collect = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name)) return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collect(path);
      return sourcePattern.test(path) ? [path] : [];
    }),
  );
  return groups.flat();
};

const hasBody = (node: ts.Node): boolean =>
  (ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)) &&
  node.body !== undefined;

const commentSentences = (comment: string): number =>
  comment
    .replace(/^\/\/|^\/\*+|\*+\/$/g, "")
    .replace(/^\s*\*/gm, "")
    .replace(/\b(?:e\.g|i\.e|etc|vs)\./g, "")
    .split(/[.!?](?:\s+|$)/)
    .filter((part) => part.trim()).length;

const commentRanges = (source: ts.SourceFile): ts.CommentRange[] => {
  const text = source.getFullText();
  const seen = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
    ])
      seen.set(range.pos, range);
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...seen.values()];
};

const paths = process.argv.slice(2);
const files = paths.length ? paths : await collect(".");
let failures = 0;
for (const file of files) {
  if (!sourcePattern.test(file)) continue;
  const content = await readFile(file, "utf8");
  const firstLine = content.split("\n", 1)[0] ?? "";
  if (firstLine === GENERATED_MARKER || firstLine.startsWith(`${GENERATED_MARKER} `)) continue;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const effectNames = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (statement.moduleSpecifier.text === "effect" && bindings && ts.isNamedImports(bindings))
      for (const binding of bindings.elements)
        if ((binding.propertyName?.text ?? binding.name.text) === "Effect")
          effectNames.add(binding.name.text);
    if (
      statement.moduleSpecifier.text === "effect/Effect" &&
      bindings &&
      ts.isNamespaceImport(bindings)
    )
      effectNames.add(bindings.name.text);
  }
  const effectGenerator = (node: ts.Node): boolean => {
    if (
      !ts.isFunctionExpression(node) ||
      !node.asteriskToken ||
      node.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword)
    )
      return false;
    const call = node.parent;
    return (
      ts.isCallExpression(call) &&
      call.arguments.includes(node) &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "gen" &&
      ts.isIdentifier(call.expression.expression) &&
      effectNames.has(call.expression.expression.text)
    );
  };
  const reportAt = (position: number, message: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(position);
    console.error(`${file}:${line + 1}:${character + 1}: ${message}`);
    failures += 1;
  };
  const report = (node: ts.Node, message: string) => reportAt(node.getStart(source), message);
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionExpression(node) && !effectGenerator(node)) || hasBody(node))
      report(node, "Use an arrow function.");
    if (ts.isNonNullExpression(node)) report(node, "Non-null assertions are prohibited.");
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.exclamationToken)
      report(node, "Definite assignment assertions are prohibited.");
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, "Explicit any is prohibited.");
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.UnknownKeyword)
        report(node, "Assertions to unknown are prohibited.");
      if (node.type.kind === ts.SyntaxKind.NeverKeyword)
        report(node, "Assertions to never are prohibited.");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const range of commentRanges(source)) {
    if (commentSentences(content.slice(range.pos, range.end)) > 1)
      reportAt(range.pos, "Keep comments to one sentence.");
  }
  const exempt = /(?:\.test\.|\.spec\.|(?:^|\/)tests?\/|(?:^|\/)fixtures?\/)/.test(file);
  if (!exempt && content.split("\n").length > 350)
    console.warn(`${file}: exceeds the 350-line soft cap.`);
}
process.exitCode = failures ? 1 : 0;
