import { isRecord, type ToolResult } from "@mcp-cli/core";

const knownKeys = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const locationText = (value: unknown): string | undefined =>
  typeof value === "string" &&
  value.length > 0 &&
  [...value].every(
    (character) =>
      character.charCodeAt(0) >= 32 &&
      character.charCodeAt(0) !== 127 &&
      character !== "\u2028" &&
      character !== "\u2029",
  )
    ? value
    : undefined;

const snippet = (value: unknown): string | undefined => {
  if (
    !isRecord(value) ||
    !knownKeys(value, ["file_path", "start_line", "end_line", "score", "content"])
  )
    return undefined;
  const path = locationText(value.file_path);
  const start = value.start_line;
  const end = value.end_line;
  if (
    !path ||
    typeof start !== "number" ||
    !Number.isSafeInteger(start) ||
    start < 1 ||
    typeof end !== "number" ||
    !Number.isSafeInteger(end) ||
    end < start ||
    (value.content !== undefined && typeof value.content !== "string") ||
    (value.score !== undefined && typeof value.score !== "number")
  )
    return undefined;
  return `${path}:${start}-${end}${value.content ? `\n${value.content}` : ""}`;
};

export const formatSearchResult = (result: ToolResult): string | undefined => {
  if (
    result.isError ||
    result.content.length !== 1 ||
    !knownKeys(result, ["content", "structuredContent", "isError"])
  )
    return undefined;
  const block = result.content[0];
  if (
    !block ||
    block.type !== "text" ||
    typeof block.text !== "string" ||
    !knownKeys(block, ["type", "text"])
  )
    return undefined;
  if (
    result.structuredContent !== undefined &&
    (!isRecord(result.structuredContent) ||
      !knownKeys(result.structuredContent, ["result"]) ||
      result.structuredContent.result !== block.text)
  )
    return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(block.text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(payload) ||
    !knownKeys(payload, ["query", "results", "repos"]) ||
    typeof payload.query !== "string" ||
    !Array.isArray(payload.results)
  )
    return undefined;
  const rendered = payload.results.map(snippet);
  if (rendered.some((value) => value === undefined)) return undefined;
  const sections: string[] = [];
  if (payload.repos !== undefined) {
    if (!isRecord(payload.repos)) return undefined;
    const repos: string[] = [];
    for (const [prefix, source] of Object.entries(payload.repos)) {
      const name = locationText(prefix);
      const path = locationText(source);
      if (!name || !path) return undefined;
      repos.push(`${name}: ${path}`);
    }
    if (repos.length) sections.push(`Repositories:\n${repos.join("\n")}`);
  }
  sections.push(rendered.length ? rendered.join("\n\n") : "No matches.");
  return sections.join("\n\n");
};
