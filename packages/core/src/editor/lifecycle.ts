import { runCleanupSteps } from "../runtime/cleanup";

type Cleanup = () => void;

export function createEditorLifecycle() {
  let destroyed = false;
  let editorDestroying = false;
  let recoverDestroy: Cleanup | undefined;
  const viewDisposers = new Set<Cleanup>();
  let viewDisposersClosed = false;

  return {
    get destroyed() {
      return destroyed;
    },
    get editorDestroying() {
      return editorDestroying;
    },
    beginEditorDestroy() {
      editorDestroying = true;
    },
    setRecoveryAction(action: Cleanup) {
      recoverDestroy = action;
    },
    recoverDestroy() {
      recoverDestroy?.();
    },
    registerViewDisposer(dispose: Cleanup) {
      if (viewDisposersClosed) {
        // 销毁期间重入登记的资源也必须立即释放。
        dispose();
        return () => {};
      }
      viewDisposers.add(dispose);
      return () => {
        viewDisposers.delete(dispose);
      };
    },
    closeViewDisposers() {
      if (viewDisposersClosed) return;
      // 先关闭登记并取出队列，避免清理回调重入时重复执行。
      viewDisposersClosed = true;
      const pending = [...viewDisposers];
      viewDisposers.clear();
      runCleanupSteps(pending, "Editor view cleanup failed");
    },
    failInitialization(error: unknown, steps: readonly Cleanup[]): never {
      runCleanupSteps(
        [
          () => {
            throw error;
          },
          ...steps,
        ],
        "Editor initialization failed",
      );
      throw error;
    },
    dispose(steps: () => readonly Cleanup[]) {
      if (destroyed) return;
      // 宿主回调可能重新进入销毁流程，必须先标记再执行清理。
      destroyed = true;
      runCleanupSteps(steps(), "Editor cleanup failed");
    },
  };
}

export type EditorLifecycle = ReturnType<typeof createEditorLifecycle>;
