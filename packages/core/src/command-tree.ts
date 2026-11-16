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
  /** `bootstrap` is a session-discovery plugin's bundled list, `live` its server's current list. */
  origin: "static" | "bootstrap" | "live";
  /** Session-discovery plugins return their live catalog only when the request asks for it. */
  discovery: boolean;
  fetchedAt?: number;
  workspace?: string;
  root: CommandNode;
};
