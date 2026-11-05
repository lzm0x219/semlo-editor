import type { Editor } from "@tiptap/core";

import { detailsToolbarSelection } from "../../features/blocks/details-selection";
import { getHeadingSelection } from "../../features/heading/selection";
import { readDocumentFont } from "../../features/text/document-font";

const headingFontSizes = ["", "", "24px", "", "16px", "14px", "14px"] as const;

/** 读取与界面元素无关的选区状态，供工具栏投影使用。 */
export function readToolbarSelection(editor: Editor) {
  const selectedHeading = getHeadingSelection(editor.state);
  const detailsSelection = detailsToolbarSelection(editor.state.selection);
  return { selectedHeading, detailsSelection, detailsRestricted: detailsSelection !== "other" };
}

export function readToolbarTypography(editor: Editor, selectedHeading: ReturnType<typeof getHeadingSelection>) {
  const fontAttributes = editor.getAttributes("textStyle");
  let documentFont = { family: null as string | null, name: null as string | null };
  try {
    documentFont = readDocumentFont(editor.state.doc.attrs);
  } catch {
    // 无效的文档字体不应阻止工具栏显示。
  }
  const fontLabel =
    String(
      fontAttributes.semloEditorFontName || fontAttributes.fontFamily || documentFont.name || documentFont.family || "",
    ).replace(/^['"]|['"]$/g, "") || "字体";
  const headingSizes = new Set(selectedHeading.headingLevels.map((level) => headingFontSizes[level]));
  const fontSize = selectedHeading.headingsOnly
    ? headingSizes.size === 1
      ? [...headingSizes][0]
      : ""
    : (editor.getAttributes("textStyle").fontSize ?? "15px");
  return { fontLabel, fontSize };
}

export function readToolbarAlignment(editor: Editor) {
  return ["center", "right", "justify"].find((value) => editor.isActive({ textAlign: value })) ?? "left";
}
