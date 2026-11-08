import type { Editor } from "@tiptap/core";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import { TextSelection } from "@tiptap/pm/state";

import { getWritingAssistant } from "../../features/writing-assistant/session";
import { toolbarWritingIcon } from "./icons";
import { createToolbarBindings, refreshToolbarButtons } from "./toolbar";
import type { ToolbarButton, ToolbarButtonFactory } from "./toolbar";

/** 浮动工具栏独立拥有控件、状态刷新和编辑器扩展。 */
export function createBubbleToolbar(doc: Document, primaryToolbar?: HTMLElement) {
  const element = createBubbleRoot(doc);
  let buttons: ToolbarButton[] = [];
  let mounted = false;
  let disposed = false;

  return {
    element,
    createExtension: () => createBubbleExtension(element, doc, primaryToolbar),
    mount({
      syncTextSelection,
      getEditor,
    }: {
      syncTextSelection: () => void;
      getEditor: () => Editor;
      openLink: (anchor: HTMLButtonElement) => void;
    }) {
      if (mounted || disposed) throw new Error("浮动工具栏已装配或销毁");
      mounted = true;
      const bindings = createToolbarBindings({
        doc,
        toolbar: element,
        syncTextSelection: () => {
          if (!disposed) syncTextSelection();
        },
      });
      buttons = bindings.buttons;
      const button: ToolbarButtonFactory = (parent, label, icon, action, active, enabled, state) =>
        bindings.button(
          parent,
          label,
          icon,
          (event) => {
            if (!disposed) action(event);
          },
          active,
          enabled,
          state,
        );
      mountWritingButton({ bubble: element, button, getEditor });
    },
    refresh(editor: Editor) {
      if (!disposed) refreshToolbarButtons(editor, buttons);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { element: button } of buttons) button.disabled = true;
    },
  };
}

function createBubbleRoot(doc: Document) {
  const bubble = doc.createElement("div");
  bubble.className = "semlo-editor-bubble";
  bubble.setAttribute("role", "toolbar");
  bubble.setAttribute("aria-label", "选中文字工具");
  bubble.style.visibility = "hidden";
  // 显示前设定测量宽度，避免首次定位时按父容器整行宽度计算。
  bubble.style.width = "max-content";
  return bubble;
}

function createBubbleExtension(bubble: HTMLElement, doc: Document, primaryToolbar?: HTMLElement) {
  const view = doc.defaultView;
  // 浮动菜单只接受一个滚动目标，通过独立节点转发当前实例祖先的滚动事件。
  const scrollTarget = doc.createElement("div");
  const forwardScroll = (event: Event) => {
    const target = event.target;
    if (
      target === doc ||
      target === view ||
      (target && "contains" in target && typeof target.contains === "function" && target.contains(bubble))
    ) {
      scrollTarget.dispatchEvent(new (view?.Event ?? Event)("scroll"));
    }
  };
  const startScrollTracking = () => {
    doc.addEventListener("scroll", forwardScroll, true);
    view?.addEventListener("scroll", forwardScroll);
  };
  const stopScrollTracking = () => {
    doc.removeEventListener("scroll", forwardScroll, true);
    view?.removeEventListener("scroll", forwardScroll);
  };
  return BubbleMenu.configure({
    element: bubble,
    updateDelay: 0,
    options: primaryToolbar
      ? {
          scrollTarget,
          onShow: startScrollTracking,
          onHide: stopScrollTracking,
          onDestroy: stopScrollTracking,
          flip: ({ elements, rects }) => ({
            rootBoundary: bubbleBoundary(doc, primaryToolbar, elements.reference, rects.floating),
          }),
          shift: ({ elements, rects }) => {
            const rootBoundary = bubbleBoundary(doc, primaryToolbar, elements.reference, rects.floating);
            return { rootBoundary, crossAxis: rootBoundary !== "viewport" };
          },
        }
      : undefined,
    shouldShow: ({ editor: active, element, view, state, from, to }) =>
      active.isEditable &&
      state.selection instanceof TextSelection &&
      !state.selection.empty &&
      Boolean(state.doc.textBetween(from, to)) &&
      (view.hasFocus() || element.contains(doc.activeElement)),
  });
}

function bubbleBoundary(
  doc: Document,
  toolbar: HTMLElement,
  reference: { getBoundingClientRect: () => Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width"> },
  floating: { width: number; height: number },
) {
  const view = doc.defaultView;
  if (!view || !toolbar.isConnected) return "viewport" as const;
  const viewport = view.visualViewport;
  // Floating UI 在 WebKit 中会为自定义边界减去视觉视口偏移，先在同一坐标系比较工具栏。
  const webkit = Boolean(viewport && view.CSS?.supports?.("-webkit-backdrop-filter", "none"));
  const offsetX = webkit ? (viewport?.offsetLeft ?? 0) : 0;
  const offsetY = webkit ? (viewport?.offsetTop ?? 0) : 0;
  const x = (viewport?.offsetLeft ?? 0) - offsetX;
  const y = (viewport?.offsetTop ?? 0) - offsetY;
  const width = viewport?.width ?? doc.documentElement.clientWidth;
  const height = viewport?.height ?? doc.documentElement.clientHeight;
  const toolbarRect = toolbar.getBoundingClientRect();
  const referenceRect = reference.getBoundingClientRect();
  const left = referenceRect.left + (referenceRect.width - floating.width) / 2;
  const shiftedLeft = Math.max(x, Math.min(left, x + width - floating.width));
  const overlapsHorizontally =
    Math.min(left, shiftedLeft) < toolbarRect.right && Math.max(left, shiftedLeft) + floating.width > toolbarRect.left;
  if (
    !toolbarRect.width ||
    !toolbarRect.height ||
    toolbarRect.bottom <= y ||
    toolbarRect.top >= y + height ||
    !overlapsHorizontally ||
    referenceRect.bottom <= toolbarRect.top ||
    referenceRect.top - floating.height - 8 >= toolbarRect.bottom
  ) {
    return "viewport" as const;
  }
  // Tiptap 的 offset 在 flip 和 shift 之后执行，额外留出相同距离避免最终位置重新覆盖工具栏。
  const top = Math.max(y, toolbarRect.bottom + 8);
  if (y + height - top >= floating.height + 8) {
    return { x: x + offsetX, y: top + offsetY, width, height: y + height - top };
  }
  const bottom = Math.min(y + height, toolbarRect.top - 8);
  if (bottom - y >= floating.height + 8) return { x: x + offsetX, y: y + offsetY, width, height: bottom - y };
  const rightBoundary = Math.max(x, toolbarRect.right + 8);
  if (x + width - rightBoundary >= floating.width) {
    return { x: rightBoundary + offsetX, y: y + offsetY, width: x + width - rightBoundary, height };
  }
  const leftBoundary = Math.min(x + width, toolbarRect.left - 8);
  if (leftBoundary - x >= floating.width) return { x: x + offsetX, y: y + offsetY, width: leftBoundary - x, height };
  return "viewport" as const;
}

function mountWritingButton({
  bubble,
  button,
  getEditor,
}: {
  bubble: HTMLElement;
  button: ToolbarButtonFactory;
  getEditor: () => Editor;
}) {
  const writing = button(
    bubble,
    "AI 写作",
    "",
    () => getWritingAssistant(getEditor())?.open(),
    undefined,
    () => Boolean(getWritingAssistant(getEditor())?.getSnapshot().available),
  );
  writing.innerHTML = toolbarWritingIcon;
  writing.style.color = "var(--semlo-editor-accent)";
}
