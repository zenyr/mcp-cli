import type { ToolSession } from "@mcp-cli/core";

type Entry = {
  id: string;
  service: string;
  credential?: string;
  workspace?: string;
  openedAt: number;
  session: Promise<ToolSession>;
  active: number;
  leases: number;
  lastUsed: number;
  timer?: ReturnType<typeof setTimeout>;
  drained?: () => void;
  retiring?: Promise<void>;
};

export const createPool = (idleMs = 60_000, limit = 32) => {
  const entries = new Map<string, Entry>();
  const retiring = new Set<Promise<void>>();
  let resetting: Promise<void> | undefined;
  let stopped = false;
  const retire = (key: string, entry: Entry): Promise<void> => {
    if (entry.retiring) return entry.retiring;
    if (entries.get(key) === entry) entries.delete(key);
    clearTimeout(entry.timer);
    const closing = (async () => {
      if (entry.active)
        await new Promise<void>((resolve) => {
          entry.drained = resolve;
        });
      const session = await entry.session.catch(() => undefined);
      await session?.close();
    })();
    entry.retiring = closing;
    retiring.add(closing);
    void closing
      .finally(() => {
        retiring.delete(closing);
      })
      .catch(() => undefined);
    return closing;
  };
  const schedule = (key: string, entry: Entry) => {
    if (!entry.active && !entry.leases && entries.get(key) === entry)
      entry.timer = setTimeout(() => {
        void retire(key, entry).catch(() => undefined);
      }, idleMs);
  };
  const retain = (key: string) => {
    const entry = entries.get(key);
    if (!entry) throw new Error("Connection is not available");
    clearTimeout(entry.timer);
    entry.leases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.leases -= 1;
      entry.lastUsed = Date.now();
      schedule(key, entry);
    };
  };
  const reset = async (stop = false) => {
    stopped ||= stop;
    if (resetting) return resetting;
    resetting = Promise.allSettled(
      [...entries].map(([key, entry]) => retire(key, entry)).concat([...retiring]),
    )
      .then(() => undefined)
      .finally(() => {
        resetting = undefined;
      });
    return resetting;
  };
  const use = async <T>(
    key: string,
    service: string,
    open: () => Promise<ToolSession>,
    run: (session: ToolSession) => Promise<T>,
    credential?: string,
    workspace?: string,
  ): Promise<T> => {
    await resetting;
    if (stopped) throw new Error("Daemon is stopping");
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= limit) throw new Error(`Connection pool limit reached (${limit})`);
      entry = {
        id: crypto.randomUUID(),
        service,
        credential,
        workspace,
        openedAt: Date.now(),
        session: Promise.resolve().then(open),
        active: 0,
        leases: 0,
        lastUsed: Date.now(),
      };
      entries.set(key, entry);
    }
    const current = entry;
    clearTimeout(current.timer);
    current.active += 1;
    try {
      return await run(await current.session);
    } catch (error) {
      // Failed calls are never retried because the server may have already performed them.
      if (entries.get(key) === current) entries.delete(key);
      void retire(key, current).catch(() => undefined);
      throw error;
    } finally {
      current.active -= 1;
      current.lastUsed = Date.now();
      if (!current.active) {
        current.drained?.();
        schedule(key, current);
      }
    }
  };
  return {
    use,
    retain,
    reset,
    status: () =>
      [...entries.values()].map(
        ({ id, service, credential, workspace, openedAt, active, leases, lastUsed }) => ({
          id,
          service,
          credential,
          workspace,
          openedAt,
          active,
          leases,
          lastUsed,
        }),
      ),
  };
};
