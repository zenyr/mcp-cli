import type { JsonSchema } from "@mcp-to-cli/core";
import { property } from "./schema";

const globalFlags = new Set(["--json", "--help", "-h"]);

export const parseArguments = (argv: string[], schema: JsonSchema = {}) => {
  const args: string[] = [];
  const path: string[] = [];
  let json = false;
  let wantsHelp = false;
  let inOptions = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (globalFlags.has(arg)) {
      if (arg === "--json") json = true;
      else wantsHelp = true;
      continue;
    }
    if (!inOptions && !arg.startsWith("-")) {
      path.push(arg);
      continue;
    }
    inOptions = true;
    args.push(arg);
    let field = schema;
    for (const segment of arg.slice(2).split(".")) field = property(field, segment);
    const next = argv[index + 1];
    const consumesValue =
      arg.startsWith("--") &&
      !arg.startsWith("--no-") &&
      (field.type !== "boolean" || next === "true" || next === "false");
    if (consumesValue && next !== undefined) {
      args.push(next);
      index++;
    }
  }
  return { path, args, json, wantsHelp };
};
