import type { Editor, Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";

/** 与默认链接按钮一致的选中和可用状态。 */
export interface LinkState {
  active: boolean;
  enabled: boolean;
}

export type LinkEditResult = "applied" | "invalid-url" | "invalid-text" | "unavailable" | "rejected";

/** 会话因文档、只读或视图生命周期变化失效时同步通知调用方。 */
export interface LinkEditOptions {
  onInvalidate?(): void;
}

/** 一次链接编辑会话持有目标选区，不持有或创建界面。 */
export interface LinkEditSession {
  readonly text: string;
  readonly href: string | null;
  readonly existing: boolean;
  readonly range: Readonly<Range>;
  isValid(): boolean;
  apply(value: { text: string; href: string }): LinkEditResult;
  remove(): boolean;
  close(): void;
}

/** 与默认弹层一致地校验和规范化链接地址。 */
export function normalizeLinkURL(value: string): string | null {
  if (typeof value !== "string") return null;
  let trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (trimmed.startsWith("#") || trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed;
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") return trimmed;
  } catch {
    // 无法解析的地址保持无效。
  }
  return null;
}

/** 读取链接按钮状态；只读时仍可读取选中状态。 */
export function getLinkState(editor: Editor): LinkState {
  if (editor.isDestroyed) return { active: false, enabled: false };
  return {
    active: editor.isActive("link"),
    enabled: editor.isEditable && isLinkRangeSupported(editor, editor.state.selection),
  };
}

function isLinkRangeSupported(editor: Editor, { from, to }: Range): boolean {
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  // 链接表单编辑单个文本块，跨块替换文字会合并原有段落结构。
  return $from.parent.isTextblock && $from.sameParent($to);
}

function withoutLinkColor(marks: readonly Mark[]): Mark[] {
  return marks.flatMap((mark) => {
    if (mark.type.name !== "textStyle") return [mark];
    const attrs = { ...mark.attrs, color: null, semloEditorGradient: null };
    return Object.values(attrs).some((value) => value !== null && value !== undefined) ? [mark.type.create(attrs)] : [];
  });
}

interface BeginLinkEditOptions extends LinkEditOptions {
  range?: Range;
  prepared?: boolean;
  unavailable?: () => boolean;
}

/** 供内置插入入口复用斜杠范围及既有历史边界。 */
export function beginLinkEdit(editor: Editor, options: BeginLinkEditOptions = {}): LinkEditSession | null {
  const unavailable = () => editor.isDestroyed || !editor.isEditable || Boolean(options.unavailable?.());
  if (unavailable() || !isLinkRangeSupported(editor, options.range ?? editor.state.selection)) return null;
  if (!options.prepared && !options.range && editor.state.selection.empty && editor.isActive("link"))
    editor.commands.extendMarkRange("link");
  if (unavailable() || !isLinkRangeSupported(editor, options.range ?? editor.state.selection)) return null;
  const existing = !options.prepared && !options.range && editor.isActive("link");
  let { from, to } = options.range ?? editor.state.selection;
  if (!existing) {
    const state = editor.state;
    const link = state.schema.marks.link;
    if (!link || !editor.can().setMark("link")) return null;
    const tr = state.tr;
    if (from === to || options.range) {
      const marks = withoutLinkColor(state.storedMarks ?? state.doc.resolve(from).marks()).filter(
        (mark) => mark.type !== link,
      );
      tr.replaceWith(from, to, state.schema.text("链接", link.create({ href: null }).addToSet(marks)));
      to = from + "链接".length;
    } else {
      tr.addMark(from, to, link.create({ href: null }));
      // 新建链接使用默认链接色，其他文字属性与占位在同一历史事务中保留。
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const current = node.marks.find((mark) => mark.type.name === "textStyle");
        if (!current) return;
        const next = withoutLinkColor([current])[0];
        if (next?.eq(current)) return;
        const start = Math.max(from, pos),
          end = Math.min(to, pos + node.nodeSize);
        tr.removeMark(start, end, current.type);
        if (next) tr.addMark(start, end, next);
      });
    }
    if (!tr.docChanged) return null;
    tr.setSelection(TextSelection.create(tr.doc, from, to)).setMeta("preventAutolink", true);
    // 块插入已创建历史边界，其他入口需单独记录占位。
    editor.view.dispatch(options.prepared ? tr : closeHistory(tr));
    if (unavailable() || !editor.state.doc.eq(tr.doc)) return null;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    if (unavailable() || !editor.state.doc.eq(tr.doc)) return null;
  }
  const doc = editor.state.doc;
  const text = doc.textBetween(from, to, " ");
  const href = existing ? (editor.getAttributes("link").href ?? null) : null;
  const { anchor, head } = editor.state.selection;
  const view = editor.view.dom;
  let active = true;
  const close = () => {
    if (!active) return;
    active = false;
    editor.off("transaction", onTransaction);
    editor.off("unmount", invalidate);
    editor.off("destroy", invalidate);
    view.removeEventListener("semlo-editor:document-replace", invalidate);
    view.removeEventListener("semlo-editor:editable", onEditable);
  };
  const invalidate = () => {
    if (!active) return;
    close();
    options.onInvalidate?.();
  };
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) invalidate();
  };
  const onEditable = () => {
    if (!editor.isEditable) invalidate();
  };
  const isValid = () => {
    if (active && (unavailable() || editor.state.doc !== doc)) invalidate();
    return active;
  };
  editor.on("transaction", onTransaction);
  editor.on("unmount", invalidate);
  editor.on("destroy", invalidate);
  view.addEventListener("semlo-editor:document-replace", invalidate);
  view.addEventListener("semlo-editor:editable", onEditable);
  return {
    text,
    href,
    existing,
    range: { from, to },
    isValid,
    apply(value) {
      if (!isValid()) return "unavailable";
      const url = normalizeLinkURL(value.href);
      if (!url) return "invalid-url";
      if (typeof value.text !== "string" || !value.text.trim()) return "invalid-text";
      if (!isValid()) return "unavailable";
      const chain = editor.chain().focus().setTextSelection({ from, to });
      if (text && value.text === text) chain.setLink({ href: url });
      else {
        // 修改链接文字时保留首个选中文字或当前输入样式。
        let marks = editor.state.storedMarks ?? editor.state.doc.resolve(from).marks();
        if (from !== to) {
          let foundText = false;
          editor.state.doc.nodesBetween(from, to, (node) => {
            if (!foundText && node.isText) {
              marks = node.marks;
              foundText = true;
            }
            return !foundText;
          });
        }
        const preservedMarks = marks.filter((mark) => mark.type.name !== "link").map((mark) => mark.toJSON());
        const linkAttrs = editor.isActive("link") ? editor.getAttributes("link") : {};
        chain.insertContent({
          type: "text",
          text: value.text,
          marks: [...preservedMarks, { type: "link", attrs: { ...linkAttrs, href: url } }],
        });
      }
      let attempted: Transaction | undefined;
      const result = chain
        .command(({ tr }) => {
          attempted = tr;
          return true;
        })
        .run();
      close();
      if (editor.isDestroyed || options.unavailable?.()) return "unavailable";
      if (!result || (attempted?.docChanged && !editor.isDestroyed && editor.state.doc.eq(doc))) return "rejected";
      return "applied";
    },
    remove() {
      if (!isValid() || !existing) return false;
      let attempted: Transaction | undefined;
      const result = editor
        .chain()
        .focus()
        .setTextSelection({ from: anchor, to: head })
        .extendMarkRange("link")
        .unsetLink()
        .command(({ tr }) => {
          attempted = tr;
          return true;
        })
        .run();
      close();
      return result && !(attempted?.docChanged && !editor.isDestroyed && editor.state.doc.eq(doc));
    },
    close,
  };
}

/** 开始一次链接编辑；调用方负责关闭未完成的会话。 */
export function startLinkEdit(editor: Editor, options: LinkEditOptions = {}): LinkEditSession | null {
  return beginLinkEdit(editor, options);
}
