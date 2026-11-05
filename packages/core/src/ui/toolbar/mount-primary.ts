import type { Editor } from "@tiptap/core";

import type { BlockInsertTarget } from "../../features/blocks/actions/target";
import { getHeadingStyleState, setHeadingStyle } from "../../features/heading/style-command";
import { getBoldState, toggleBold } from "../../features/text/bold-command";
import { setFontSizeOutsideHeadings } from "../../features/text/font-size-shortcuts";
import { openLocalFonts } from "../../features/text/local-fonts";
import { openDropdown } from "../../platform/dom/dropdown";
import { createFormatPainterButton } from "../format-painter/format-painter";
import { icon, type createToolbarBindings } from "./toolbar";

interface PrimaryToolbarContext {
  readonly editor: Editor;
  closeDropdown: (() => void) | undefined;
  closeFonts: (() => void) | undefined;
  closePopover: () => void;
  readonly closeCardMenu: (() => void) | undefined;
  readonly closeEmoji: (() => void) | undefined;
  showCardMenu: (anchor?: HTMLElement, target?: BlockInsertTarget, focusSearch?: boolean) => void;
}

export function mountPrimaryToolbar({
  doc,
  toolbar,
  bindings,
  syncTextSelection,
  context,
}: {
  doc: Document;
  toolbar: HTMLElement;
  bindings: ReturnType<typeof createToolbarBindings>;
  syncTextSelection: () => void;
  context: PrimaryToolbarContext;
}) {
  const { buttons, menuButton, button, separator } = bindings;
  const heading = menuButton("段落样式", "semlo-editor-heading");
  heading.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = heading.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (wasOpen) return;
    const current = getHeadingStyleState(context.editor).level;
    context.closeDropdown = openDropdown(
      heading,
      Array.from({ length: 7 }, (_, level) => ({
        label: level ? `标题${level}` : "正文",
        value: String(level),
        shortcut: `⌥ ⌘ ${level}`,
        className: `semlo-editor-heading-option semlo-editor-h${level}`,
        selected: current === level,
      })),
      (value) => {
        const level = Number(value) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
        setHeadingStyle(context.editor, level);
      },
      { label: "段落样式", leadingSelection: true, keyboardWithinMenu: true },
    );
  });
  const insertButton = button(toolbar, "插入内容", "plus", (event) =>
    context.showCardMenu(insertButton, undefined, event.detail === 0),
  );
  insertButton.classList.add("semlo-editor-insert-button");
  insertButton.setAttribute("aria-haspopup", "dialog");
  insertButton.setAttribute("aria-expanded", "false");
  separator();
  button(
    toolbar,
    "撤销",
    "undo",
    () => context.editor.chain().focus().undo().run(),
    undefined,
    () => context.editor.can().undo(),
  );
  button(
    toolbar,
    "重做",
    "redo",
    () => context.editor.chain().focus().redo().run(),
    undefined,
    () => context.editor.can().redo(),
  );
  const painterButton = createFormatPainterButton(doc);
  toolbar.append(painterButton);
  buttons.push({ element: painterButton });
  button(toolbar, "清除文字格式", "clear", () => context.editor.chain().focus().unsetAllMarks().run());
  separator();
  toolbar.append(heading);
  const fontFamily = menuButton("字体", "semlo-editor-font-family");
  fontFamily.setAttribute("aria-haspopup", "dialog");
  const fontLabel = doc.createElement("span");
  fontLabel.textContent = "字体";
  fontFamily.append(fontLabel);
  fontFamily.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = fontFamily.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    context.closeEmoji?.();
    context.closeFonts?.();
    if (wasOpen) return;
    context.closeFonts = openLocalFonts(context.editor, fontFamily);
  });
  toolbar.append(fontFamily);
  const fontSize = menuButton("字号", "semlo-editor-font-size");
  fontSize.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = fontSize.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (wasOpen) return;
    const current = context.editor.getAttributes("textStyle").fontSize ?? "15px";
    context.closeDropdown = openDropdown(
      fontSize,
      ["12", "13", "14", "15", "16", "19", "22", "24", "29", "32", "40", "48"].map((size) => ({
        label: `${size}px`,
        value: `${size}px`,
        selected: current === `${size}px`,
      })),
      (value) => {
        if (setFontSizeOutsideHeadings(context.editor, value)) context.editor.view.focus();
        else context.editor.chain().focus().setFontSize(value).run();
      },
    );
  });
  toolbar.append(fontSize);
  separator();
  button(
    toolbar,
    "加粗",
    "bold",
    () => toggleBold(context.editor),
    undefined,
    undefined,
    () => getBoldState(context.editor),
  );
  button(
    toolbar,
    "斜体",
    "italic",
    () => context.editor.chain().focus().toggleItalic().run(),
    () => context.editor.isActive("italic"),
  );
  button(
    toolbar,
    "删除线",
    "strike",
    () => context.editor.chain().focus().toggleStrike().run(),
    () => context.editor.isActive("strike"),
  );
  button(
    toolbar,
    "下划线",
    "underline",
    () => context.editor.chain().focus().toggleUnderline().run(),
    () => context.editor.isActive("underline"),
  );
  const script = menuButton("上下标", "semlo-editor-script");
  script.title = "更多文本样式";
  script.setAttribute("aria-description", "更多文本样式：上标、下标、行内代码");
  script.textContent = "Tˣ";
  script.addEventListener("click", () => {
    syncTextSelection();
    const wasOpen = script.getAttribute("aria-expanded") === "true";
    context.closeDropdown?.();
    context.closePopover();
    context.closeCardMenu?.();
    if (wasOpen) return;
    const styles = [
      { label: "上标", value: "superscript", selected: context.editor.isActive("superscript") },
      { label: "下标", value: "subscript", selected: context.editor.isActive("subscript") },
      { label: "行内代码", value: "code", selected: context.editor.isActive("code") },
    ];
    context.closeDropdown = openDropdown(
      script,
      styles.map((style) => ({ ...style, className: "semlo-editor-text-style-option" })),
      (value) => {
        if (value === "superscript") context.editor.chain().focus().unsetSubscript().toggleSuperscript().run();
        else if (value === "subscript") context.editor.chain().focus().unsetSuperscript().toggleSubscript().run();
        else if (value === "code") context.editor.chain().focus().toggleCode().run();
      },
    );
    // openDropdown associates the menu with its trigger, including when the
    // toolbar item has moved into the overflow menu. Decorate only this menu.
    const popupId = script.getAttribute("aria-controls")?.trim().split(/\s+/).at(-1);
    const popup = popupId ? doc.getElementById(popupId) : null;
    popup?.setAttribute("aria-label", "更多文本样式");
    for (const style of styles) {
      const row = popup?.querySelector<HTMLButtonElement>(`[data-value="${style.value}"]`);
      if (!row) continue;
      row.insertAdjacentHTML("afterbegin", icon(style.value));
      row.firstElementChild?.classList.add("semlo-editor-text-style-icon");
      row.setAttribute("aria-label", style.label);
      row.setAttribute("aria-description", style.selected ? "已启用" : "未启用");
      if (style.selected) row.setAttribute("aria-current", "true");
      row.disabled =
        style.value === "superscript"
          ? !context.editor.can().toggleSuperscript()
          : style.value === "subscript"
            ? !context.editor.can().toggleSubscript()
            : !context.editor.can().toggleCode();
    }
  });
  toolbar.append(script);

  return { heading, fontFamily, fontLabel, fontSize, script, painterButton };
}
