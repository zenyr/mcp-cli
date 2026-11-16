/** One node of a service's command hierarchy, carrying the same text as `--help`. */
export type CommandNode = {
  path: string[];
  kind: "service" | "group" | "command" | "workflow";
  summary: string;
  tool?: string;
  help: string;
  children: CommandNode[];
};
export type CommandCatalog = {
  service: string;
  /** Session-discovery plugins describe their bundled bootstrap catalog. */
  bootstrap: boolean;
  root: CommandNode;
};
