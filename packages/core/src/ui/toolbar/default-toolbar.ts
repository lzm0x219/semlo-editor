import type { Editor } from "@tiptap/core";

import { findInPageIcon, moreHorizontalIcon } from "../material-icons";
import { toolbarTranslationIcon } from "./icons";
import { mountFormattingToolbar } from "./mount-formatting";
import { mountPrimaryToolbar } from "./mount-primary";
import { refreshToolbarState } from "./state";
import { createToolbarBindings } from "./toolbar";

type PrimaryContext = Parameters<typeof mountPrimaryToolbar>[0]["context"];
type FormattingContext = Parameters<typeof mountFormattingToolbar>[0]["context"];

/** 默认工具栏拥有控件与显示状态；宿主仍负责编辑器及共享弹层的生命周期。 */
export function createDefaultToolbar(options: {
  doc: Document;
  toolbar: HTMLElement;
  shell: HTMLElement;
  syncTextSelection: () => void;
  primaryContext: PrimaryContext;
}) {
  const { doc, toolbar, shell, syncTextSelection, primaryContext } = options;
  const bindings = createToolbarBindings({ doc, toolbar, syncTextSelection });
  const primary = mountPrimaryToolbar({
    doc,
    toolbar,
    bindings,
    syncTextSelection,
    context: {
      get editor() {
        return primaryContext.editor;
      },
      get closeDropdown() {
        return primaryContext.closeDropdown;
      },
      set closeDropdown(value) {
        primaryContext.closeDropdown = value;
      },
      get closeFonts() {
        return primaryContext.closeFonts;
      },
      set closeFonts(value) {
        primaryContext.closeFonts = value;
      },
      closePopover: () => primaryContext.closePopover(),
      get closeCardMenu() {
        return primaryContext.closeCardMenu;
      },
      get closeEmoji() {
        return primaryContext.closeEmoji;
      },
      showCardMenu: (anchor, target, focusSearch) => primaryContext.showCardMenu(anchor, target, focusSearch),
    },
  });
  let formatting: ReturnType<typeof mountFormattingToolbar> | undefined;
  let translationButton: HTMLButtonElement | undefined;
  const getFormatting = () => {
    if (!formatting) throw new Error("工具栏格式控件尚未装配");
    return formatting;
  };
  return {
    painterButton: primary.painterButton,
    mountFormatting(context: FormattingContext) {
      formatting = mountFormattingToolbar({ doc, toolbar, bindings, syncTextSelection, context });
    },
    mountActions(options: { translationAvailable: boolean; openTranslation: (anchor: HTMLButtonElement) => void }) {
      const findButton = doc.createElement("button");
      findButton.type = "button";
      findButton.className = "semlo-editor-button";
      const applePlatform = /Mac|iPhone|iPad|iPod/i.test(doc.defaultView?.navigator.platform ?? "");
      findButton.title = `查找替换 ${applePlatform ? "⌘F" : "Ctrl+F"}`;
      findButton.setAttribute("aria-label", "查找替换");
      findButton.setAttribute("aria-haspopup", "dialog");
      findButton.setAttribute("aria-expanded", "false");
      findButton.innerHTML = findInPageIcon;
      findButton.addEventListener("mousedown", (event) => event.preventDefault());
      toolbar.append(findButton);
      const translation = doc.createElement("button");
      translationButton = translation;
      translation.type = "button";
      translation.className = "semlo-editor-button";
      translation.setAttribute("aria-label", "翻译");
      translation.setAttribute("aria-expanded", "false");
      translation.title = options.translationAvailable ? "翻译" : "请先配置翻译服务";
      translation.disabled = !options.translationAvailable;
      translation.innerHTML = toolbarTranslationIcon;
      translation.addEventListener("mousedown", (event) => event.preventDefault());
      translation.addEventListener("click", () => options.openTranslation(translation));
      toolbar.append(translation);
      const moreButton = doc.createElement("button");
      moreButton.type = "button";
      moreButton.className = "semlo-editor-button semlo-editor-toolbar-more";
      moreButton.setAttribute("aria-label", "更多");
      moreButton.setAttribute("aria-haspopup", "toolbar");
      moreButton.setAttribute("aria-expanded", "false");
      moreButton.title = "更多";
      moreButton.innerHTML = moreHorizontalIcon;
      return { findButton, moreButton };
    },
    setTranslationAvailable(available: boolean) {
      if (!translationButton) return;
      translationButton.disabled = !available;
      translationButton.title = available ? "翻译" : "请先配置翻译服务";
    },
    applyHighlightColor() {
      getFormatting().highlightColor.applyCurrent();
    },
    refresh(editor: Editor) {
      const controls = getFormatting();
      refreshToolbarState({
        editor,
        buttons: bindings.buttons,
        heading: primary.heading,
        fontFamily: primary.fontFamily,
        fontLabel: primary.fontLabel,
        fontSize: primary.fontSize,
        script: primary.script,
        ...controls,
        shell,
      });
    },
  };
}
