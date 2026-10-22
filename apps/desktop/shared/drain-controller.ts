export const createDrainController = () => {
  let accepting = true;
  const active = new Set<Promise<unknown>>();
  return {
    accepting: () => accepting,
    run: async <T>(action: () => Promise<T>): Promise<T> => {
      if (!accepting) throw new Error("앱을 업데이트하고 있습니다. 잠시 후 다시 시도해 주세요.");
      const task = Promise.resolve().then(action);
      active.add(task);
      try {
        return await task;
      } finally {
        active.delete(task);
      }
    },
    drain: async (cancel: () => Promise<void>) => {
      accepting = false;
      await cancel();
      await Promise.allSettled([...active]);
    },
  };
};
