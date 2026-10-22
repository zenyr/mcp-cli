export const createLoginController = () => {
  let active: { controller: AbortController; settled: Promise<unknown> } | undefined;
  return {
    start: async (run: (signal: AbortSignal) => Promise<unknown>) => {
      if (active) throw new Error("기존 로그인 요청을 먼저 완료해 주세요.");
      const controller = new AbortController();
      let cancel = () => {};
      const cancelled = new Promise<{ cancelled: true }>((resolve) => {
        cancel = () => resolve({ cancelled: true });
      });
      controller.signal.addEventListener("abort", cancel, { once: true });
      const task = {
        controller,
        settled: Promise.race([Promise.resolve().then(() => run(controller.signal)), cancelled]),
      };
      active = task;
      try {
        await task.settled;
        return controller.signal.aborted ? { cancelled: true as const } : null;
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        if (active === task) active = undefined;
      }
    },
    cancel: async () => {
      const task = active;
      task?.controller.abort();
      await task?.settled.catch(() => undefined);
    },
  };
};
