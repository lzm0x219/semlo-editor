import type { Editor } from "@tiptap/core";

import { getListState, toggleList } from "../../features/list/list-command";
import { setOrderedListStyle } from "../../features/list/ordered-style";
import { openOrderedListStyleMenu } from "../../features/list/ordered-style-menu";
import { getLinkState } from "../../features/references/link-command";
import { validGradient } from "../../features/text/color-gradient";
import { applyHighlightColor } from "../../features/text/highlight";
import {
  adjustParagraphIndent,
  getParagraphLineHeight,
  LINE_HEIGHT_VALUES,
  setParagraphLineHeight,
  type LineHeight,
} from "../../features/text/paragraph-layout";
import { openDropdown } from "../../platform/dom/dropdown";
import { openPalette } from "../controls/color-picker";
import { openToolbarAlignmentMenu } from "./alignment-menu";
import { createToolbarColorControl } from "./color-control";
import { toolbarAlignmentIcon, toolbarIndentIcon, toolbarLineHeightIcon } from "./icons";
import type { createToolbarBindings } from "./toolbar";

interface FormattingToolbarContext {
  readonly editor: Editor;
  closeDropdown: (() => void) | undefined;
  closePopover(): void;
  readonly closeCardMenu: (() => void) | undefined;
  readonly closeEmoji: (() => void) | undefined;
  readonly closeFonts: (() => void) | undefined;
  openLink(anchor: HTMLElement): void;
}

export function mountFormattingToolbar({
  doc,
  toolbar,
  bindings,
  syncTextSelection,
  context,
}: {
  doc: Document;
  toolbar: HTMLElement;
  bindings: ReturnType<typeof createToolbarBindings>;
  syncTextSelection(): void;
  context: FormattingToolbarContext;
}) {
  const { menuButton, button, separator } = bindings;
  separator();
  const colorControl = (
    kind: "text" | "background",
    apply: (value: string | null, live: boolean, session: symbol) => void,
  ) => {
    const control = createToolbarColorControl(
      doc,
      kind,
      (value) => {
        syncTextSelection();
        context.closeDropdown?.();
        context.closePopover();
        context.closeCardMenu?.();
        apply(value, false, Symbol("color-apply"));
      },
      () => {
        syncTextSelection();
        const wasOpen = control.arrow.getAttribute("aria-expanded") === "true";
        context.closeDropdown?.();
        context.closePopover();
        context.closeCardMenu?.();
        if (!wasOpen) {
          const session = Symbol("color-picker-session");
          const textStyle = context.editor.getAttributes("textStyle");
          const active =
            kind === "text"
              ? textStyle.semloEditorGradient || textStyle.color
              : context.editor.getAttributes("highlight").color;
          context.closeDropdown = openPalette(control.arrow, {
            kind,
            active: typeof active === "string" ? active : null,
            onChoose: (value, live) => {
              control.setColor(value);
              apply(value, live, session);
            },
          });
        }
      },
    );
    toolbar.append(control.element);
    return control;
  };
  const textColor = colorControl("text", (value, live, session) => {
    const chain = context.editor.chain();
    if (!live) chain.focus();
    const gradient = validGradient(value);
    chain
      .command(({ tr }) => {
        if (live) tr.setMeta("composition", session);
        return true;
      })
      .setMark("textStyle", { color: gradient ? null : value, semloEditorGradient: gradient })
      .removeEmptyTextStyle()
      .command(({ tr, state }) => {
        if (!value && tr.selection.empty) {
          const mark = tr.storedMarks?.find((item) => item.type === state.schema.marks.textStyle);
          if (mark && Object.values(mark.attrs).every((attribute) => !attribute)) tr.removeStoredMark(mark.type);
        }
        return true;
      })
      .run();
  });
  const highlightColor = colorControl("background", (value, live, session) => {
    applyHighlightColor(context.editor, value, live, session);
  });
  separator();
  const alignment = menuButton("文本对齐", "semlo-editor-alignment");
  alignment.innerHTML = toolbarAlignmentIcon("left");
  alignment.addEventListener("click", (event) => {
    syncTextSelection();
    const wasOpen = alignment.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (!wasOpen)
      context.closeDropdown = openToolbarAlignmentMenu(
        alignment,
        alignment.dataset.value ?? "left",
        (value) => context.editor.chain().focus().setTextAlign(value).run(),
        event.detail === 0,
      );
  });
  toolbar.append(alignment);
  button(
    toolbar,
    "无序列表",
    "bullet",
    () => toggleList(context.editor, "bulletList"),
    undefined,
    undefined,
    () => getListState(context.editor, "bulletList"),
  );
  const orderedControl = doc.createElement("span");
  orderedControl.className = "semlo-editor-ordered-style-control";
  button(
    orderedControl,
    "有序列表",
    "ordered",
    () => toggleList(context.editor, "orderedList"),
    undefined,
    undefined,
    () => getListState(context.editor, "orderedList"),
  );
  const orderedArrow = doc.createElement("button");
  orderedArrow.type = "button";
  orderedArrow.className = "semlo-editor-ordered-style-arrow";
  orderedArrow.setAttribute("aria-label", "有序列表样式");
  orderedArrow.setAttribute("aria-haspopup", "menu");
  orderedArrow.setAttribute("aria-expanded", "false");
  orderedArrow.addEventListener("mousedown", (event) => event.preventDefault());
  orderedArrow.addEventListener("click", (event) => {
    syncTextSelection();
    const wasOpen = orderedArrow.getAttribute("aria-expanded") === "true";
    context.closePopover();
    context.closeDropdown?.();
    context.closeEmoji?.();
    context.closeFonts?.();
    context.closeCardMenu?.();
    if (wasOpen) return;
    const current = context.editor.isActive("orderedList")
      ? context.editor.getAttributes("orderedList").semloEditorOrderedStyle
      : "mixed";
    context.closeDropdown = openOrderedListStyleMenu(
      orderedArrow,
      current ?? "mixed",
      (style) => {
        setOrderedListStyle(context.editor, style);
        context.editor.view.focus();
      },
      event.detail === 0,
    );
  });
  orderedControl.append(orderedArrow);
  toolbar.append(orderedControl);
  const indent = menuButton("缩进调整", "semlo-editor-indent-trigger");
  indent.innerHTML = toolbarIndentIcon;
  indent.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = indent.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (wasOpen) return;
    context.closeDropdown = openDropdown(
      indent,
      [
        { label: "增加缩进", value: "increase" },
        { label: "减少缩进", value: "decrease" },
      ],
      (value) => {
        adjustParagraphIndent(context.editor, value === "increase" ? 1 : -1);
        context.editor.view.focus();
      },
    );
  });
  toolbar.append(indent);
  const lineHeight = menuButton("行高调整", "semlo-editor-line-height-trigger");
  lineHeight.innerHTML = toolbarLineHeightIcon;
  lineHeight.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = lineHeight.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (wasOpen) return;
    const current = getParagraphLineHeight(context.editor);
    context.closeDropdown = openDropdown(
      lineHeight,
      [
        { label: "默认", value: "default", selected: current === null },
        ...LINE_HEIGHT_VALUES.map((value) => ({ label: value, value, selected: current === value })),
      ],
      (value) => {
        setParagraphLineHeight(context.editor, value === "default" ? null : (value as LineHeight));
        context.editor.view.focus();
      },
    );
  });
  toolbar.append(lineHeight);
  button(
    toolbar,
    "待办事项",
    "task",
    () => toggleList(context.editor, "taskList"),
    undefined,
    undefined,
    () => getListState(context.editor, "taskList"),
  );
  const toolbarLink = button(
    toolbar,
    "链接",
    "link",
    () => context.openLink(toolbarLink),
    undefined,
    undefined,
    () => getLinkState(context.editor),
  );
  toolbarLink.setAttribute("aria-haspopup", "dialog");
  toolbarLink.setAttribute("aria-expanded", "false");
  button(
    toolbar,
    "引用",
    "quote",
    () => context.editor.chain().focus().toggleBlockquote().run(),
    () => context.editor.isActive("blockquote"),
  );
  button(toolbar, "分割线", "divider", () => context.editor.chain().focus().setHorizontalRule().run());
  separator();
  return { textColor, highlightColor, alignment, orderedArrow, indent, lineHeight };
}
