import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** 新同级项继承缩进等格式；独立编号起点和待办完成状态只属于原项。 */
export function siblingItemAttrs(source: ProseMirrorNode): Record<string, unknown> {
  const attrs = { ...source.attrs };
  if (Object.hasOwn(attrs, "semloEditorListRestart")) attrs.semloEditorListRestart = false;
  if (source.type.name === "taskItem") attrs.checked = false;
  return attrs;
}
