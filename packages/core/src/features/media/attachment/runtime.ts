export function createAttachmentViews() {
  let disposed = false;
  const listeners = new Set<() => void>();
  return {
    get disposed() {
      return disposed;
    },
    subscribe(listener: () => void) {
      if (disposed) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate() {
      if (disposed) return;
      // 监听器只移除旧 iframe 并安排微任务，不在此阶段调用宿主解析器。
      runCleanupSteps(Array.from(listeners), "Attachment views invalidation failed");
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      const pending = Array.from(listeners);
      listeners.clear();
      runCleanupSteps(pending, "Attachment views cleanup failed");
    },
  };
}

export type AttachmentViews = ReturnType<typeof createAttachmentViews>;
import { runCleanupSteps } from "../../../runtime/cleanup";
