import { getText, getTextSerializersFromSchema, type Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { documentWithoutSlashDraft } from "../../features/insertion/slash-draft";
import { sequenceConversionHintAttribute } from "../../features/list/numbering-sequence-conversion-hint";
import {
  sequenceRegistryAttribute,
  sequenceMemberAttribute,
  sequenceLinkAttribute,
} from "../../features/list/numbering-sequence-document";
import { normalizeOrderedListLevelStarts } from "../../features/list/ordinals";
import type { EditorSnapshot } from "../../types";
import { cloneContentValue } from "./clone-value";
import { serializeEditorHTML } from "./html-output";

function snapshotJSON(content: ProseMirrorNode): JSONContent {
  // 根属性及嵌套属性可能与宿主共享，投影后仍需解除快照的对象别名。
  const json = cloneContentValue(content.toJSON());
  const pending: JSONContent[] = [json];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "heading" && node.attrs?.semloEditorHeadingAnchor == null && node.attrs)
      delete node.attrs.semloEditorHeadingAnchor;
    if (node.type === "heading" && node.attrs?.semloEditorHeadingFolded === false)
      delete node.attrs.semloEditorHeadingFolded;
    if (node.type === "orderedList" && node.attrs) {
      // ProseMirror can share attribute objects with the document.
      const attrs = { ...node.attrs };
      if (attrs[sequenceRegistryAttribute] == null) delete attrs[sequenceRegistryAttribute];
      if (attrs[sequenceLinkAttribute] == null) delete attrs[sequenceLinkAttribute];
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
    if (node.type === "listItem" && node.attrs?.[sequenceMemberAttribute] == null && node.attrs)
      delete node.attrs[sequenceMemberAttribute];
    if (
      (node.type === "listItem" || node.type === "taskItem" || node.type === "paragraph" || node.type === "heading") &&
      node.attrs?.[sequenceConversionHintAttribute] == null &&
      node.attrs
    )
      delete node.attrs[sequenceConversionHintAttribute];
    if (node.type === "semloEditorAudio" && node.attrs?.allowDownload == null && node.attrs)
      delete node.attrs.allowDownload;
    if (node.type === "semloEditorAttachment" && node.attrs?.allowDownload == null && node.attrs)
      delete node.attrs.allowDownload;
    if (node.type === "semloEditorMindmap" && node.attrs?.layout == null && node.attrs) delete node.attrs.layout;
    if (node.type === "semloEditorMindmap" && node.attrs?.drawing == null && node.attrs) delete node.attrs.drawing;
    if (node.type === "semloEditorMindmap" && node.attrs?.annotations == null && node.attrs)
      delete node.attrs.annotations;
    if (node.type === "semloEditorMindmap" && node.attrs?.canvasShapes == null && node.attrs)
      delete node.attrs.canvasShapes;
    for (const child of node.content ?? []) pending.push(child);
  }
  return json;
}

export function getEditorSnapshot(editor: Editor, doc: Document): EditorSnapshot {
  const content = documentWithoutSlashDraft(editor.state);
  return {
    json: snapshotJSON(content),
    html: serializeEditorHTML(editor, doc, content),
    text:
      content === editor.state.doc
        ? editor.getText()
        : getText(content, { blockSeparator: "\n\n", textSerializers: getTextSerializersFromSchema(editor.schema) }),
  };
}
