import type { Editor, EditorEvents } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export const attachmentEditMeta = "semloEditorAttachmentEdit";

/** 宿主 beforeTransaction 可以只改权限而不改正文，提交附件属性前仍要复核。 */
export function withAttachmentGuard(Base: typeof Editor): typeof Editor {
  return class AttachmentGuardEditor extends Base {
    override emit<K extends keyof EditorEvents>(
      event: K,
      ...args: EditorEvents[K] extends any[] ? EditorEvents[K] : [EditorEvents[K]]
    ): this {
      const result = super.emit(event, ...args);
      if (event === "beforeTransaction") {
        const transaction = (args[0] as { transaction: Transaction }).transaction;
        const valid = transaction.getMeta(attachmentEditMeta) as (() => boolean) | undefined;
        if (valid && !valid()) throw new Error("附件编辑目标已失效，本次修改已中止");
      }
      return result;
    }
  };
}
