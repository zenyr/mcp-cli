import type { UpdateInstance } from "./update-instance";

type Detail = { error?: string; requestId?: string };
type Request = { requestId?: string };

// Failures from an earlier request stay readable but do not abort a newer one.
export const isRequestFailure = (instance: UpdateInstance, requestId: string | undefined) =>
  instance.state === "failed" &&
  (instance.requestId === undefined || instance.requestId === requestId);

const parse = (text: string, instanceId: string): Request | null => {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !("instanceId" in value) ||
    value.instanceId !== instanceId
  )
    return null;
  return "requestId" in value && typeof value.requestId === "string"
    ? { requestId: value.requestId }
    : {};
};

export const createUpdateRequestHandler = (options: {
  instanceId: string;
  read: () => Promise<string | null>;
  record: (state: UpdateInstance["state"], detail?: Detail) => Promise<void>;
  stop: () => Promise<void>;
  resume: () => void;
  discard: () => Promise<void>;
  finish: () => Promise<void>;
}) => {
  const handled = new Set<string>();
  let stopping = false;
  let checking = false;
  let started = false;
  const check = async () => {
    if (stopping || checking) return;
    checking = true;
    let request: Request | null = null;
    try {
      const text = await options.read();
      if (!text) return;
      request = parse(text, options.instanceId);
      if (!request || (request.requestId && handled.has(request.requestId))) return;
      if (request.requestId) handled.add(request.requestId);
      stopping = true;
      started = true;
      await options.record("draining", { requestId: request.requestId });
      await options.stop();
      await options.finish();
    } catch (error) {
      if (!stopping) return;
      await options
        .record("failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: request?.requestId,
        })
        .catch(() => {});
      await options.discard().catch(() => {});
      options.resume();
      stopping = false;
    } finally {
      checking = false;
    }
  };
  return {
    start: () => options.record("starting"),
    check,
    ready: async () => {
      if (!started) await options.record("ready");
    },
  };
};
