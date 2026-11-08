import type { EditorEvents, Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export const writingAcceptMeta = "semloEditorWritingAssistantAccept";
const writingGuards = new WeakMap<Editor, { invalidate(): void; refresh(): void }>();
const editableTransitions = new WeakMap<Editor, number>();

export function setWritingGuardHooks(editor: Editor, hooks?: { invalidate(): void; refresh(): void }) {
  if (hooks) writingGuards.set(editor, hooks);
  else writingGuards.delete(editor);
}

export function writingEditableTransition(editor: Editor): boolean {
  return Boolean(editableTransitions.get(editor));
}

/** 在所有 beforeTransaction 宿主监听器之后、文档提交之前再次核验归属。 */
export function withWritingAssistantGuard(Base: typeof Editor): typeof Editor {
  return class WritingGuardEditor extends Base {
    override setEditable(editable: boolean, emitUpdate = true) {
      if (this.options.editable === editable) return super.setEditable(editable, emitUpdate);
      const depth = editableTransitions.get(this) ?? 0;
      // abort 监听器可同步重入。旧请求失效前先封住过渡窗口，防止按旧的 isEditable 开新请求。
      editableTransitions.set(this, depth + 1);
      try {
        if (!editable) writingGuards.get(this)?.invalidate();
        return super.setEditable(editable, emitUpdate);
      } finally {
        if (depth) editableTransitions.set(this, depth);
        else {
          editableTransitions.delete(this);
          // 状态已稳定；此通知中重新打开的会话属于新的可用期。
          writingGuards.get(this)?.refresh();
        }
      }
    }
    override emit<K extends keyof EditorEvents>(
      event: K,
      ...args: EditorEvents[K] extends any[] ? EditorEvents[K] : [EditorEvents[K]]
    ): this {
      const result = super.emit(event, ...args);
      if (event === "beforeTransaction") {
        const transaction = (args[0] as { transaction: Transaction }).transaction;
        const valid = transaction.getMeta(writingAcceptMeta) as (() => boolean) | undefined;
        if (valid && !valid()) throw new Error("写作目标已失效，接纳事务已中止");
      }
      return result;
    }
  };
}
