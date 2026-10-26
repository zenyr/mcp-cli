import { formatOutput, formatText } from "./output";
import { UsageError, type PromptDefinition, type PromptResult } from "@mcp-cli/core";
import {
  operands,
  unknownSubcommand,
  withSession,
  rejectFlags,
  type CatalogDependencies,
  type CatalogRequest,
} from "./catalog";
import { parseInput, validateUserInput } from "./input";
import { flagForm } from "./reserved";

const PROMPTS = "prompts";

// Prompt arguments are strings, so a string schema reuses flag parsing and validation.
const argumentSchema = (prompt: PromptDefinition) => ({
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    prompt.arguments.map((arg) => [
      arg.name,
      { type: "string", ...(arg.description !== undefined && { description: arg.description }) },
    ]),
  ),
  required: prompt.arguments.filter((arg) => arg.required).map((arg) => arg.name),
});

const promptText = (prompt: PromptDefinition): string =>
  [
    [prompt.name, prompt.description].filter(Boolean).join("  "),
    ...prompt.arguments.map((arg) =>
      [
        `  --${flagForm(arg.name)}`,
        arg.required ? "(required)" : "(optional)",
        ...(arg.description ? [`- ${arg.description}`] : []),
      ].join(" "),
    ),
  ].join("\n");

const messageText = (result: PromptResult): string =>
  result.messages
    .map(({ role, content }) => {
      const body =
        content.type === "text" && typeof content.text === "string"
          ? formatText(content.text)
          : formatOutput(content);
      return `${role}:\n${body}`;
    })
    .join("\n\n");

const checkArguments = (prompt: PromptDefinition, input: Record<string, unknown>): void => {
  const known = new Set(prompt.arguments.map((arg) => arg.name));
  const unknown = Object.keys(input).filter((key) => !known.has(key));
  if (unknown.length)
    throw new UsageError(`Unknown argument for prompt ${prompt.name}: ${unknown.join(", ")}`);
  const missing = prompt.arguments.filter((arg) => arg.required && !Object.hasOwn(input, arg.name));
  if (missing.length)
    throw new UsageError(
      `Missing required argument for prompt ${prompt.name}: ${missing.map((arg) => `--${flagForm(arg.name)}`).join(", ")}`,
    );
};

const stringArguments = (input: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

export const runPrompts = async (
  request: CatalogRequest,
  dependencies: CatalogDependencies,
): Promise<number> => {
  const [subcommand] = request.path;
  const write = (value: unknown, text: string): void =>
    dependencies.io.write(request.json ? JSON.stringify(value, null, 2) : text);
  if (subcommand === "list") {
    rejectFlags(request, PROMPTS);
    operands(request, `${PROMPTS} list [--json]`, 0);
    const prompts = await withSession(dependencies, (session) => session.listPrompts());
    write(prompts, prompts.length ? prompts.map(promptText).join("\n") : "No prompts");
    return 0;
  }
  if (subcommand === "get") {
    const [name = ""] = operands(request, `${PROMPTS} get <name> [--<argument> value]`, 1);
    const invalid = request.tokens.find((token) => token.kind === "invalid");
    if (invalid) throw new UsageError(invalid.message);
    return withSession(dependencies, async (session) => {
      const prompt = (await session.listPrompts()).find((item) => item.name === name);
      if (!prompt)
        throw new UsageError(`Unknown prompt: ${name}; run ${request.service} ${PROMPTS} list`);
      const schema = argumentSchema(prompt);
      const input = await parseInput(request.tokens, schema, dependencies.io);
      checkArguments(prompt, input);
      validateUserInput(schema, input);
      const result = await session.getPrompt(name, stringArguments(input));
      write(result, messageText(result));
      return 0;
    });
  }
  throw unknownSubcommand(request, PROMPTS);
};
