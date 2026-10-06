import { COMMANDS, FLAGS, RESERVED_FLAGS } from "@mcp-cli/core";

export const {
  help: HELP,
  methods: METHODS,
  call: CALL,
  skill: SKILL,
  resources: RESOURCES,
  prompts: PROMPTS,
} = COMMANDS;
export const {
  json: JSON_FLAG,
  help: HELP_FLAG,
  input: INPUT_FLAG,
  inputFile: INPUT_FILE_FLAG,
  allowRepeat: ALLOW_REPEAT_FLAG,
} = FLAGS;

export const flagForm = (key: string): string => key.replaceAll("_", "-");
// Properties whose flag form is a global flag can only be set through --input.
export const isReservedField = (key: string): boolean => RESERVED_FLAGS.includes(flagForm(key));
