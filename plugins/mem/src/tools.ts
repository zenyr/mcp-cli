import { isRecord, type ToolResult } from "@mcp-cli/core";
import { main } from "@mcp-cli/mem";

export type MemContext = { cwd: string; env: Record<string, string | undefined> };

const scope = {
  type: "string",
  enum: ["global", "project"],
  description: "Use only global records or only the current Git project. Default: both.",
};
const maxBytes = {
  type: "integer",
  minimum: 512,
  maximum: 20480,
  description: "Byte limit for the whole mem JSON response. Default: 8192.",
};
const cursor = { type: "string", description: "Cursor from the previous response." };
// Every call may create the SQLite store or scope rows, so no tool is read-only.
const annotations = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: { ...properties, scope, maxBytes },
  ...(required.length && { required }),
  additionalProperties: false,
});

export const tools = [
  {
    name: "read",
    description:
      "Read one original record page. Pass a recordId from recall or start, then pass the returned cursor for the next page.",
    annotations,
    inputSchema: schema(
      {
        record: { type: "string", minLength: 1, description: "Record id such as <scopeId>/0." },
        cursor,
      },
      ["record"],
    ),
  },
  {
    name: "recall",
    description:
      "Search original records by keyword, newest first. Keep the same query and scope when you pass the returned cursor.",
    annotations,
    inputSchema: schema(
      {
        query: { type: "string", minLength: 1, description: "Keyword to search for." },
        cursor,
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Default: 20." },
      },
      ["query"],
    ),
  },
  {
    name: "start",
    description:
      "Build the startup memory packet from saved summaries without calling a model. Fails with SUMMARY_PENDING until `mem summarize` runs.",
    annotations,
    inputSchema: schema({}),
  },
];

class InvalidInput extends Error {}

const field = (input: Record<string, unknown>, key: string, type: "string" | "integer") => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (type === "string" ? typeof value !== "string" : !Number.isSafeInteger(value))
    throw new InvalidInput(`${key} must be ${type === "string" ? "a string" : "an integer"}.`);
  return String(value);
};

// mem's parser reads any argument that starts with -- as an option, so positional values must not.
const positional = (input: Record<string, unknown>, key: string): string => {
  const value = field(input, key, "string");
  if (!value) throw new InvalidInput(`${key} is required.`);
  if (value.startsWith("--")) throw new InvalidInput(`${key} must not start with --.`);
  return value;
};

const option = (flag: string, value: string | undefined): string[] =>
  value === undefined ? [] : [flag, value];

/** Converts one tool call into the argv the mem CLI accepts. */
export const toArgv = (name: string, input: unknown): string[] => {
  if (!isRecord(input)) throw new InvalidInput("Arguments must be an object.");
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new InvalidInput(`Unknown tool: ${name}.`);
  const unknown = Object.keys(input).find(
    (key) => !Object.hasOwn(tool.inputSchema.properties, key),
  );
  if (unknown !== undefined)
    throw new InvalidInput(`Unknown argument: ${JSON.stringify(unknown)}.`);
  const selected = field(input, "scope", "string");
  if (selected !== undefined && selected !== "global" && selected !== "project")
    throw new InvalidInput("scope must be global or project.");
  const common = [
    ...(selected ? [`--${selected}`] : []),
    ...option("--max-bytes", field(input, "maxBytes", "integer")),
  ];
  const paging = option("--cursor", field(input, "cursor", "string"));
  if (name === "recall")
    return [
      "recall",
      positional(input, "query"),
      ...paging,
      ...option("--limit", field(input, "limit", "integer")),
      ...common,
    ];
  if (name === "read") return ["read", positional(input, "record"), ...paging, ...common];
  return ["start", ...common];
};

const invalid = (message: string): ToolResult => ({
  isError: true,
  content: [
    {
      type: "text",
      text: JSON.stringify({ ok: false, error: { code: "INVALID_OPTION", message, details: {} } }),
    },
  ],
});

const noInput = async (): Promise<string> => {
  throw new InvalidInput("mem tools do not read files or stdin.");
};

/** Runs one tool through the mem CLI and returns its JSON response as text. */
export const callTool = async (
  name: string,
  input: unknown,
  context: MemContext,
): Promise<ToolResult> => {
  let argv: string[];
  try {
    argv = toArgv(name, input);
  } catch (error) {
    if (error instanceof InvalidInput) return invalid(error.message);
    throw error;
  }
  let text = "";
  const code = await main(argv, {
    cwd: context.cwd,
    env: context.env,
    io: {
      write: (chunk) => {
        text += chunk;
      },
      readFile: noInput,
      readStdin: noInput,
    },
  });
  return {
    content: [{ type: "text", text: text.trimEnd() }],
    ...(code !== 0 && { isError: true }),
  };
};
