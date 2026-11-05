import { cancelUploadLifetimes } from "../integrations/upload-cancellation";
import { runCleanupSteps } from "../runtime/cleanup";
import { TransactionGuardEditor } from "../runtime/transaction-guard";
import type { EditorLifecycle } from "./lifecycle";

export function createControllerEditorClass(lifecycle: EditorLifecycle): typeof TransactionGuardEditor {
  // Tiptap 的销毁回调可能在视图销毁前重入，标记必须先于回调触发。
  return class ControllerEditor extends TransactionGuardEditor {
    override destroy() {
      lifecycle.beginEditorDestroy();
      try {
        runCleanupSteps([() => cancelUploadLifetimes(this), () => super.destroy()], "Editor destruction failed");
      } catch (error) {
        // 宿主回调抛错会中断 Tiptap 销毁；继续释放 UI、视图及监听器。
        const failures: unknown[] = [error];
        try {
          lifecycle.recoverDestroy();
        } catch (failure) {
          failures.push(failure);
        }
        try {
          if (!this.isDestroyed) this.unmount();
        } catch (failure) {
          failures.push(failure);
        }
        try {
          // 宿主可能覆写 removeAllListeners；恢复时不再重复调用该覆写。
          super.removeAllListeners();
        } catch (failure) {
          failures.push(failure);
        }
        if (failures.length === 1) throw error;
        throw new AggregateError(failures, "Editor destruction failed");
      }
    }
  };
}
