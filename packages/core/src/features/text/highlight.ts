import type { Editor } from "@tiptap/core";

/** 未选择高亮颜色时使用的初始值，工具栏与快捷键共用。 */
export const DEFAULT_HIGHLIGHT_COLOR = "#fbde28";

/** 颜色面板和键盘快捷键共享同一高亮写入路径。 */
export function applyHighlightColor(editor: Editor, value: string | null, live: boolean, session: symbol) {
  const chain = editor.chain();
  if (!live) chain.focus();
  if (live)
    chain.command(({ tr }) => {
      tr.setMeta("composition", session);
      return true;
    });
  if (value) chain.setHighlight({ color: value }).run();
  else chain.unsetHighlight().run();
}
