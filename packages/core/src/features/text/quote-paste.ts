import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

export const clipboardSourceAttribute = "data-semlo-editor-clipboard";

function hasYuqueSource(fragment: DocumentFragment): boolean {
  for (const metadata of fragment.querySelectorAll("ne-clipboard[source]")) {
    const source = metadata.getAttribute("source");
    if (!source) continue;
    try {
      const host = new URL(decodeURIComponent(source)).hostname.toLowerCase();
      if (host === "yuque.com" || host.endsWith(".yuque.com")) return true;
    } catch {
      // 无效来源不具有保留结构化引用的含义，继续按外部 HTML 处理。
    }
  }
  return false;
}

/** 按来源处理引用粘贴；不改变文档载入规则，也不读取语雀私有载荷。 */
export function normalizeExternalQuoteHTML(html: string, document: Document, preserveCellGrouping = false): string {
  if (!/<blockquote(?:\s|>)|\bne-quote\b/i.test(html)) return html;
  try {
    const template = document.createElement("template");
    template.innerHTML = html;
    if (hasYuqueSource(template.content)) {
      const quotes = Array.from(template.content.querySelectorAll("div.ne-quote"));
      if (!quotes.length) return html;
      for (const quote of quotes) {
        const blockquote = document.createElement("blockquote");
        // 原生复制的可见 HTML 使用 div.ne-quote，按其嵌套关系转成 schema 可读的引用。
        while (quote.firstChild) blockquote.appendChild(quote.firstChild);
        quote.parentNode?.replaceChild(blockquote, quote);
      }
      return template.innerHTML;
    }
    if (template.content.querySelector(`[data-pm-slice],[${clipboardSourceAttribute}="1"]`)) return html;
    // 只保留表格处理器能识别的单个引用分组；表格内部的外部引用仍按正文规则展开。
    const roots = Array.from(template.content.children);
    if (
      preserveCellGrouping &&
      roots.length === 1 &&
      roots[0].tagName === "BLOCKQUOTE" &&
      Array.from(roots[0].children).every((block) => /^(P|H[1-6]|PRE)$/.test(block.tagName))
    )
      return html;
    const quotes = Array.from(template.content.querySelectorAll("blockquote"));
    if (!quotes.length) return html;
    for (const quote of quotes) {
      const parent = quote.parentNode;
      if (!parent) continue;
      // 挪动原有子节点，保留正文、标题、内联格式及列表层级。
      while (quote.firstChild) parent.insertBefore(quote.firstChild, quote);
      parent.removeChild(quote);
    }
    return template.innerHTML;
  } catch {
    // 解析失败时交回正常粘贴流程，避免以半处理的内容替换当前选区。
    return html;
  }
}

export const QuotePaste = Extension.create({
  name: "semloEditorQuotePaste",
  priority: 50,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html, view) {
            return normalizeExternalQuoteHTML(
              html,
              view.dom.ownerDocument,
              view.state.selection instanceof CellSelection,
            );
          },
        },
      }),
    ];
  },
});
