import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { normalizeOrderedAncestorPath } from "./ordered-path";
import { deriveOrderedListValues, normalizeOrderedListLevelStarts } from "./ordinals";

/** Preserve per-level ordinals and explicit ancestors when splitting a flat list. */
export function orderedListSuffixAttrs(list: ProseMirrorNode, children: ProseMirrorNode[], index: number) {
  let nested = false;
  list.descendants((node) => {
    if (["bulletList", "orderedList", "taskList"].includes(node.type.name)) nested = true;
    return !nested && !node.isTextblock;
  });
  if (nested || index >= children.length) return { ...list.attrs, start: Number(list.attrs.start ?? 1) + index };
  const indents = children.map((item) => {
    const value = Number(item.attrs.semloEditorListIndent);
    return Number.isInteger(value) ? Math.max(0, Math.min(8, value)) : 0;
  });
  const values = deriveOrderedListValues(
    indents,
    list.attrs.start,
    list.attrs.semloEditorListLevelStarts,
    children.map((item) => item.attrs.semloEditorListRestart),
  );
  const starts: Record<string, number> = { ...normalizeOrderedListLevelStarts(list.attrs.semloEditorListLevelStarts) };
  const seen = new Set<number>();
  for (let position = index; position < children.length; position++) {
    const indent = indents[position];
    if (seen.has(indent)) continue;
    seen.add(indent);
    starts[String(indent)] = values[position];
  }
  const first = indents[index];
  const start = starts[String(first)];
  delete starts[String(first)];
  for (const level of Object.keys(starts)) if (starts[level] === 1) delete starts[level];
  const originalPath = normalizeOrderedAncestorPath(list.attrs.semloEditorOrderedAncestorPath);
  const levels = originalPath?.length === indents[0] ? [...originalPath] : [];
  for (let position = 0; position < index; position++) {
    levels[indents[position]] = values[position];
    levels.length = indents[position] + 1;
  }
  const path = Array.from({ length: first }, (_, depth) => levels[depth]);
  const ancestorPath = normalizeOrderedAncestorPath(path);
  return {
    ...list.attrs,
    start,
    semloEditorListLevelStarts: Object.keys(starts).length ? starts : null,
    ...(list.attrs.semloEditorOrderedStyle === "decimal" || originalPath
      ? { semloEditorOrderedAncestorPath: ancestorPath }
      : {}),
  };
}
