import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { deriveOrderedListValues } from "./ordinals";

export type TaskNumberChain = { prefixPos: number; taskPos: number; suffixPos: number; next: number };
const chainCounts = new WeakMap<ProseMirrorNode, Map<string, number>>();

/** Resolve only a uniquely marked, adjacent and structurally verified three-block chain. */
export function taskNumberChainAt(doc: ProseMirrorNode, suffixPos: number): TaskNumberChain | null {
  const suffix = doc.nodeAt(suffixPos);
  const id = suffix?.attrs.semloEditorListTaskChain;
  if (!suffix || suffix.type.name !== "orderedList" || typeof id !== "string" || !id) return null;
  let counts = chainCounts.get(doc);
  if (!counts) {
    counts = new Map();
    const current = counts;
    doc.descendants((node) => {
      const value = node.attrs.semloEditorListTaskChain;
      if (typeof value === "string" && value) current.set(value, (current.get(value) ?? 0) + 1);
      return !node.isTextblock;
    });
    chainCounts.set(doc, counts);
  }
  if (counts.get(id) !== 3 || doc.resolve(suffixPos).depth !== 0) return null;
  const task = doc.resolve(suffixPos).nodeBefore;
  if (!task || task.type.name !== "taskList" || task.attrs.semloEditorListTaskChain !== id || task.childCount !== 1)
    return null;
  const taskPos = suffixPos - task.nodeSize;
  const prefix = doc.resolve(taskPos).nodeBefore;
  if (!prefix || prefix.type.name !== "orderedList" || prefix.attrs.semloEditorListTaskChain !== id) return null;
  if (
    prefix.attrs.semloEditorOrderedStyle !== "decimal" ||
    Number(prefix.attrs.start ?? 1) !== 1 ||
    prefix.attrs.semloEditorListLevelStarts != null ||
    prefix.attrs.semloEditorOrderedAncestorPath != null ||
    prefix.attrs.semloEditorListFirstContinue === true ||
    prefix.childCount < 2 ||
    !["decimal", "chinese"].includes(suffix.attrs.semloEditorOrderedStyle) ||
    suffix.attrs.semloEditorListLevelStarts != null ||
    !Array.isArray(suffix.attrs.semloEditorOrderedAncestorPath) ||
    suffix.attrs.semloEditorOrderedAncestorPath.length !== 1 ||
    suffix.attrs.semloEditorOrderedAncestorPath[0] !== 1 ||
    suffix.childCount !== 1 ||
    suffix.firstChild?.type.name !== "listItem" ||
    Number(suffix.firstChild.attrs.semloEditorListIndent ?? 0) !== 1 ||
    suffix.firstChild.childCount !== 1 ||
    suffix.firstChild.firstChild?.type.name !== "paragraph" ||
    task.firstChild?.type.name !== "taskItem" ||
    Number(task.firstChild.attrs.semloEditorListIndent ?? 0) !== 1 ||
    task.firstChild.childCount !== 1 ||
    task.firstChild.firstChild?.type.name !== "paragraph"
  )
    return null;
  const indents: number[] = [];
  let valid = true;
  prefix.forEach((item, _offset, index) => {
    const indent = Number(item.attrs.semloEditorListIndent ?? 0);
    indents.push(indent);
    if (
      indent !== (index === 0 ? 0 : 1) ||
      item.attrs.semloEditorListRestart === true ||
      item.childCount !== 1 ||
      item.firstChild?.type.name !== "paragraph"
    )
      valid = false;
  });
  if (!valid) return null;
  const values = deriveOrderedListValues(indents, 1);
  const next = values[values.length - 1] + 1;
  if (!Number.isSafeInteger(next) || next > 2147483647) return null;
  return { prefixPos: taskPos - prefix.nodeSize, taskPos, suffixPos, next };
}
