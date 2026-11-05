import type { Editor, JSONContent } from "@tiptap/core";

import { normalizeOrderedListLevelStarts } from "../../features/list/ordinals";
import type { EditorSnapshot } from "../../types";
import { cloneContentValue } from "./clone-value";
import { serializeEditorHTML } from "./html-output";

function snapshotJSON(editor: Editor): JSONContent {
  // ProseMirror may share nested attrs, including reactive proxies, with the host.
  const json = cloneContentValue(editor.getJSON());
  const pending: JSONContent[] = [json];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "orderedList" && node.attrs) {
      // ProseMirror can share attribute objects with the document.
      const attrs = { ...node.attrs };
      if (attrs.semloEditorListLevelStarts == null) delete attrs.semloEditorListLevelStarts;
      else {
        const starts = normalizeOrderedListLevelStarts(attrs.semloEditorListLevelStarts);
        if (starts) attrs.semloEditorListLevelStarts = starts;
      }
      if (attrs.semloEditorOrderedStyle == null) delete attrs.semloEditorOrderedStyle;
      if (attrs.semloEditorListFirstContinue === false) delete attrs.semloEditorListFirstContinue;
      if (attrs.semloEditorListQuoteChain == null) delete attrs.semloEditorListQuoteChain;
      if (attrs.semloEditorListTaskChain == null) delete attrs.semloEditorListTaskChain;
      if (attrs.semloEditorOrderedAncestorPath == null) delete attrs.semloEditorOrderedAncestorPath;
      else if (Array.isArray(attrs.semloEditorOrderedAncestorPath))
        attrs.semloEditorOrderedAncestorPath = [...attrs.semloEditorOrderedAncestorPath];
      node.attrs = attrs;
    }
    if (node.type === "taskList" && node.attrs?.semloEditorListTaskChain == null && node.attrs) {
      node.attrs = { ...node.attrs };
      delete node.attrs.semloEditorListTaskChain;
      if (Object.keys(node.attrs).length === 0) delete node.attrs;
    }
    if (node.type === "listItem" && node.attrs?.semloEditorListRestart === false) {
      delete node.attrs.semloEditorListRestart;
    }
    for (const child of node.content ?? []) pending.push(child);
  }
  return json;
}

export function getEditorSnapshot(editor: Editor, doc: Document): EditorSnapshot {
  return {
    json: snapshotJSON(editor),
    html: serializeEditorHTML(editor, doc),
    text: editor.getText(),
  };
}
