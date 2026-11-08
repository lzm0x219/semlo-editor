/** 先撤销归属再发出 abort，避免宿主取消监听器同步重入后被旧操作覆盖。 */
export function createWritingRequestRunner() {
  let generation = 0;
  let active: { controller: AbortController; settle(): void } | undefined;
  return {
    cancel() {
      generation++;
      const previous = active;
      active = undefined;
      previous?.settle();
      previous?.controller.abort();
    },
    async run<T>(
      invoke: (signal: AbortSignal) => Promise<T>,
      receive: (value: T) => void,
      fail: (error: unknown) => void,
    ) {
      const current = ++generation;
      const previous = active;
      const cancelled = Symbol("cancelled");
      let settle!: () => void;
      const cancellation = new Promise<typeof cancelled>((resolve) => {
        settle = () => resolve(cancelled);
      });
      const request = { controller: new AbortController(), settle };
      active = request;
      previous?.settle();
      previous?.controller.abort();
      const valid = () => generation === current && active === request && !request.controller.signal.aborted;
      if (!valid()) return;
      try {
        const result = await Promise.race([invoke(request.controller.signal), cancellation]);
        if (result !== cancelled && valid()) receive(result);
      } catch (error) {
        if (valid()) fail(error);
      } finally {
        if (active === request) active = undefined;
      }
    },
  };
}
