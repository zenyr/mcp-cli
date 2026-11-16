import type { ToolDefinition } from "@mcp-cli/core";

/** Owns one connection's catalog and never publishes a superseded discovery. */
export const sessionTools = (fetch: () => Promise<ToolDefinition[]>) => {
  let generation = 0;
  let pending: Promise<ToolDefinition[]> | undefined;
  const invalidate = () => {
    generation += 1;
    pending = undefined;
  };
  const list = (): Promise<ToolDefinition[]> => {
    if (pending) return pending;
    const started = generation;
    const current = Promise.resolve()
      .then(fetch)
      .then(
        (tools) => (started === generation ? tools : list()),
        (error: unknown) => {
          if (started !== generation) return list();
          if (pending === current) pending = undefined;
          throw error;
        },
      );
    pending = current;
    return current;
  };
  return { list, invalidate };
};
