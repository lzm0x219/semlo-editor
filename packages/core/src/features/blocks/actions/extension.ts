import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { setHeadingStyle } from "../../heading/conversion";
import { preferredOrderedStyle } from "../../list/ordered-preference";
import { convertOneTask } from "../../list/task-list-conversion";
import { adjustParagraphIndent } from "../../text/paragraph-layout";
import { createBlockDrag } from "./drag";
import { createBlockMenuHelpers } from "./menu";
import {
  listNodes,
  itemNodes,
  isFlatList,
  dispatchChange,
  listGroupTextRange,
  listGroupCodePlan,
  replacement,
  listItemWrapper,
  linkedQuoteUnwrap,
  conversions,
  deleteTarget,
  clipboardContents,
  writeClipboard,
  type Conversion,
} from "./operations";
import { currentTarget, type Target, type BlockActionsOptions } from "./target";

type HeadingControls = { pos: number; foldInside: boolean; handleInside: boolean; stacked: boolean; offset: number };
type PluginState = { selected: number | null; headings: readonly HeadingControls[] };
type Action = { selected?: number | null; headings?: readonly HeadingControls[] };
const blockKey = new PluginKey<PluginState>("semloEditorBlockActions");

function sameHeadingControls(a: HeadingControls | undefined, b: HeadingControls | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.pos === b.pos &&
      a.foldInside === b.foldInside &&
      a.handleInside === b.handleInside &&
      a.stacked === b.stacked &&
      a.offset === b.offset)
  );
}

export function createBlockActions(options: BlockActionsOptions = {}) {
  return Extension.create({
    name: "semloEditorBlockActions",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin<PluginState>({
          key: blockKey,
          state: {
            init: () => ({ selected: null, headings: [] }),
            apply(tr, previous) {
              const action = tr.getMeta(blockKey) as Action | undefined;
              const headings = tr.docChanged
                ? previous.headings.flatMap((heading) => {
                    const mapped = tr.mapping.mapResult(heading.pos, 1);
                    return !mapped.deleted && tr.doc.nodeAt(mapped.pos)?.type.name === "heading"
                      ? [{ ...heading, pos: mapped.pos }]
                      : [];
                  })
                : previous.headings;
              return {
                selected: tr.docChanged ? null : action?.selected !== undefined ? action.selected : previous.selected,
                headings: action?.headings ?? headings,
              };
            },
          },
          props: {
            decorations(state) {
              const plugin = blockKey.getState(state),
                decorations: Decoration[] = [];
              if (plugin?.selected != null) {
                const node = state.doc.nodeAt(plugin.selected);
                if (node) {
                  decorations.push(
                    Decoration.node(plugin.selected, plugin.selected + node.nodeSize, {
                      class: "semlo-editor-block-actions-selected",
                    }),
                  );
                  const resolved = state.doc.resolve(plugin.selected),
                    parent = resolved.parent;
                  if (itemNodes.has(node.type.name) && listNodes.has(parent.type.name) && isFlatList(parent)) {
                    const level = Number(node.attrs.semloEditorListIndent ?? 0);
                    let pos = plugin.selected + node.nodeSize;
                    for (let index = resolved.index() + 1; index < parent.childCount; index++) {
                      const child = parent.child(index);
                      if (Number(child.attrs.semloEditorListIndent ?? 0) <= level) break;
                      decorations.push(
                        Decoration.node(pos, pos + child.nodeSize, { class: "semlo-editor-block-actions-selected" }),
                      );
                      pos += child.nodeSize;
                    }
                  }
                }
              }
              for (const heading of plugin?.headings ?? []) {
                const node = state.doc.nodeAt(heading.pos);
                if (!node || node.type.name !== "heading") continue;
                const classes = [
                  heading.foldInside && "semlo-editor-block-fold-inset",
                  heading.handleInside && "semlo-editor-block-handle-inset",
                  heading.stacked && "semlo-editor-block-fold-stacked",
                ]
                  .filter(Boolean)
                  .join(" ");
                decorations.push(
                  Decoration.node(heading.pos, heading.pos + node.nodeSize, {
                    class: classes,
                    style: `--semlo-editor-block-inset-offset:${heading.offset}px`,
                  }),
                );
              }
              return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
            },
          },
          view(view) {
            const doc = view.dom.ownerDocument,
              win = doc.defaultView;
            const handle = doc.createElement("button");
            handle.type = "button";
            handle.className = "semlo-editor-block-handle";
            handle.hidden = true;
            handle.draggable = true;
            handle.setAttribute("aria-label", "块操作");
            handle.setAttribute("aria-haspopup", "menu");
            handle.setAttribute("aria-expanded", "false");
            handle.title = "拖拽移动，点击操作";
            handle.innerHTML =
              '<svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.2"/><circle cx="11" cy="3" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="13" r="1.2"/><circle cx="11" cy="13" r="1.2"/></svg>';
            const indicator = doc.createElement("div");
            indicator.className = "semlo-editor-block-drop-indicator";
            indicator.hidden = true;
            indicator.setAttribute("aria-hidden", "true");
            doc.body.append(handle, indicator);
            let roots = new WeakMap<globalThis.Node, { pos: number; node: ProseMirrorNode }>();
            let rootEntries: Array<{ pos: number; node: ProseMirrorNode; dom: HTMLElement }> = [];
            let target: Target | null = null,
              menu: HTMLElement | null = null,
              submenu: HTMLElement | null = null,
              insertPanel: HTMLElement | null = null,
              closeInsert: (() => void) | undefined;
            let menuOffset: { x: number; y: number } | undefined;
            let drag: { source: Target } | null = null,
              destroyed = false,
              writing = false,
              writeVersion = 0;
            let hideTimer: number | undefined, layoutFrame: number | undefined, submenuTimer: number | undefined;
            const cancelSubmenuTimer = () => {
              if (submenuTimer !== undefined) win?.clearTimeout(submenuTimer);
              submenuTimer = undefined;
            };
            const onMenuHover = (action: () => void) => {
              cancelSubmenuTimer();
              if (!submenu || !win) action();
              else submenuTimer = win.setTimeout(action, 300);
            };

            const indexRoots = () => {
              roots = new WeakMap();
              rootEntries = [];
              view.state.doc.forEach((node, pos) => {
                const dom = view.nodeDOM(pos);
                if (dom) roots.set(dom, { pos, node });
                if (dom instanceof (win?.HTMLElement ?? HTMLElement))
                  rootEntries.push({ pos, node, dom: dom as HTMLElement });
              });
            };
            const resolveElement = (element: Element | null): Target | null => {
              if (!element || !view.dom.contains(element)) return null;
              let top: globalThis.Node = element;
              while (top.parentNode && top.parentNode !== view.dom) top = top.parentNode;
              if (top.parentNode !== view.dom || !(top instanceof (win?.HTMLElement ?? HTMLElement))) return null;
              const root = roots.get(top);
              if (!root) return null;
              const rootDOM = top as HTMLElement,
                li = listNodes.has(root.node.type.name) ? element.closest("li") : null;
              const heading = element.closest<HTMLElement>(".semlo-editor-heading-foldable");
              if (li && rootDOM.contains(li)) {
                try {
                  const resolved = view.state.doc.resolve(view.posAtDOM(li, 0));
                  for (let depth = resolved.depth; depth > 0; depth--) {
                    if (itemNodes.has(resolved.node(depth).type.name))
                      return currentTarget(
                        view,
                        resolved.before(depth),
                        root.pos,
                        li as HTMLElement,
                        rootDOM,
                        true,
                        heading,
                      );
                  }
                } catch {
                  /* Fall back to the whole root block. */
                }
              }
              return currentTarget(view, root.pos, root.pos, rootDOM, rootDOM, false, heading);
            };
            const targetAtSelection = (): Target | null => {
              const { $from } = view.state.selection;
              let heading: HTMLElement | null = null;
              for (let depth = $from.depth; depth > 0; depth--)
                if ($from.node(depth).type.name === "heading") {
                  const dom = view.nodeDOM($from.before(depth));
                  if (
                    dom instanceof (win?.HTMLElement ?? HTMLElement) &&
                    (dom as HTMLElement).classList.contains("semlo-editor-heading-foldable")
                  )
                    heading = dom as HTMLElement;
                  break;
                }
              if ($from.depth === 0) {
                const dom = view.nodeDOM($from.pos);
                return dom instanceof (win?.HTMLElement ?? HTMLElement)
                  ? currentTarget(
                      view,
                      $from.pos,
                      $from.pos,
                      dom as HTMLElement,
                      dom as HTMLElement,
                      false,
                      (dom as HTMLElement).classList.contains("semlo-editor-heading-foldable")
                        ? (dom as HTMLElement)
                        : null,
                    )
                  : null;
              }
              const rootPos = $from.before(1),
                rootDOM = view.nodeDOM(rootPos);
              if (!(rootDOM instanceof (win?.HTMLElement ?? HTMLElement))) return null;
              const rootNode = view.state.doc.nodeAt(rootPos);
              if (rootNode && listNodes.has(rootNode.type.name)) {
                for (let depth = $from.depth; depth > 0; depth--)
                  if (itemNodes.has($from.node(depth).type.name)) {
                    const pos = $from.before(depth),
                      dom = view.nodeDOM(pos);
                    if (dom instanceof (win?.HTMLElement ?? HTMLElement))
                      return currentTarget(
                        view,
                        pos,
                        rootPos,
                        dom as HTMLElement,
                        rootDOM as HTMLElement,
                        true,
                        heading,
                      );
                  }
              }
              return currentTarget(
                view,
                rootPos,
                rootPos,
                rootDOM as HTMLElement,
                rootDOM as HTMLElement,
                false,
                heading,
              );
            };
            // The fold button is clipped by scroll containers as well as by the viewport.
            const headingControls = (heading: HTMLElement): HeadingControls | undefined => {
              if (!win || !heading.isConnected || heading.closest(".semlo-editor-heading-fold-hidden"))
                return undefined;
              const button = heading.querySelector<HTMLButtonElement>(":scope > .semlo-editor-heading-fold-toggle");
              if (!button) return undefined;
              const pos = Number(button.dataset.semloEditorHeadingFoldPos),
                rect = heading.getBoundingClientRect();
              if (
                !Number.isInteger(pos) ||
                view.state.doc.nodeAt(pos)?.type.name !== "heading" ||
                !rect.width ||
                !rect.height
              )
                return undefined;
              let left = 4,
                right = win.innerWidth - 4;
              for (let parent = heading.parentElement; parent; parent = parent.parentElement) {
                const overflow = win.getComputedStyle(parent).overflowX;
                if (!["hidden", "clip", "scroll", "auto"].includes(overflow)) continue;
                const bounds = parent.getBoundingClientRect(),
                  innerLeft = bounds.left + parent.clientLeft;
                left = Math.max(left, innerLeft);
                right = Math.min(right, innerLeft + parent.clientWidth);
              }
              // Reserve the same control gutter in both modes so switching to
              // read-only does not reflow the heading when the handle hides.
              const foldInside = rect.left - 28 < left,
                handleInside = rect.left - 52 < left;
              if (!foldInside && !handleInside) return undefined;
              const offset = Math.max(0, Math.ceil(left - rect.left));
              const visibleWidth = Math.min(rect.right, right) - Math.max(rect.left, left);
              return {
                pos,
                foldInside,
                handleInside,
                stacked: foldInside && handleInside && visibleWidth < 84,
                offset,
              };
            };
            const setTarget = (next: Target | null) => {
              if (destroyed || menu || drag || !editor.isEditable) return;
              target = next;
              if (!target || !target.dom.isConnected || target.dom.closest(".semlo-editor-heading-fold-hidden")) {
                handle.hidden = true;
                return;
              }
              const heading = target.heading?.isConnected ? target.heading : null;
              const rect = (heading ?? target.dom).getBoundingClientRect();
              if (
                rect.bottom <= 0 ||
                rect.top >= (win?.innerHeight ?? 800) ||
                rect.right <= 0 ||
                rect.left >= (win?.innerWidth ?? 1000)
              ) {
                target = null;
                handle.hidden = true;
                return;
              }
              const controls = heading ? headingControls(heading) : undefined;
              const pos = heading
                ? Number(
                    heading.querySelector<HTMLButtonElement>(":scope > .semlo-editor-heading-fold-toggle")?.dataset
                      .semloEditorHeadingFoldPos,
                  )
                : -1;
              const applied = blockKey.getState(view.state)?.headings.find((item) => item.pos === pos);
              if (heading && !sameHeadingControls(controls, applied)) {
                handle.hidden = true;
                scheduleLayout();
                return;
              }
              const left = controls?.handleInside
                ? rect.left + controls.offset
                : rect.left -
                  (heading
                    ? 52
                    : target.dom.classList.contains("semlo-editor-list-foldable")
                      ? 56
                      : target.dom.classList.contains("semlo-editor-list-numbering-item")
                        ? 42
                        : 28);
              handle.style.left = `${Math.max(4, left)}px`;
              handle.style.top = `${Math.max(4, Math.min(rect.top + (controls?.stacked ? 28 : 3), (win?.innerHeight ?? 800) - 28))}px`;
              handle.hidden = false;
            };
            const scheduleLayout = () => {
              if (!win || destroyed || layoutFrame !== undefined) return;
              layoutFrame = win.requestAnimationFrame(() => {
                layoutFrame = undefined;
                if (destroyed || editor.isDestroyed) return;
                const headings = Array.from(view.dom.querySelectorAll<HTMLElement>(".semlo-editor-heading-foldable"))
                  .map(headingControls)
                  .filter((value): value is HeadingControls => !!value);
                const previous = blockKey.getState(view.state)?.headings ?? [];
                if (
                  headings.length !== previous.length ||
                  headings.some((heading, index) => !sameHeadingControls(heading, previous[index]))
                ) {
                  view.dispatch(
                    view.state.tr.setMeta(blockKey, { headings } satisfies Action).setMeta("addToHistory", false),
                  );
                }
                if (target && !menu && !drag) setTarget(target);
              });
            };
            const clearHide = () => {
              if (hideTimer !== undefined) win?.clearTimeout(hideTimer);
              hideTimer = undefined;
            };
            const scheduleHide = () => {
              clearHide();
              if (win)
                hideTimer = win.setTimeout(() => {
                  if (!menu && !drag) {
                    target = null;
                    handle.hidden = true;
                  }
                }, 200);
            };
            const pointerMove = (event: PointerEvent) => {
              if (menu || drag || !editor.isEditable) return;
              const element = event.target instanceof (win?.Element ?? Element) ? (event.target as Element) : null;
              if (element && (handle.contains(element) || view.dom.contains(element))) {
                clearHide();
                if (!handle.contains(element)) setTarget(resolveElement(element));
                return;
              }
              if (element?.closest(".semlo-editor-prose")) {
                clearHide();
                target = null;
                handle.hidden = true;
                return;
              }
              if (target) {
                const rect = target.dom.getBoundingClientRect();
                if (
                  event.clientX >= rect.left - 55 &&
                  event.clientX <= rect.right &&
                  event.clientY >= rect.top - 8 &&
                  event.clientY <= rect.bottom + 8
                ) {
                  clearHide();
                  return;
                }
              }
              scheduleHide();
            };
            const focus = () => {
              if (!menu && !drag) setTarget(targetAtSelection());
            };
            const reposition = () => {
              scheduleLayout();
              if (target && menu && menuOffset) {
                const rect = (target.heading ?? target.dom).getBoundingClientRect();
                if (!target.dom.isConnected || rect.bottom <= 0 || rect.top >= (win?.innerHeight ?? 800)) {
                  closeMenu();
                  target = null;
                  handle.hidden = true;
                  return;
                }
                handle.style.left = `${Math.max(4, rect.left + menuOffset.x)}px`;
                handle.style.top = `${Math.max(4, Math.min(rect.top + menuOffset.y, (win?.innerHeight ?? 800) - 28))}px`;
                positionMenu(menu, handle.getBoundingClientRect());
              } else if (target && !drag) setTarget(target);
            };
            const closeMenu = (clearSelection = true) => {
              if (!menu) return;
              cancelSubmenuTimer();
              const close = closeInsert;
              closeInsert = undefined;
              close?.();
              menu.remove();
              menu = null;
              submenu = null;
              insertPanel = null;
              menuOffset = undefined;
              writing = false;
              writeVersion++;
              handle.setAttribute("aria-expanded", "false");
              if (clearSelection && !editor.isDestroyed && blockKey.getState(view.state)?.selected !== null)
                view.dispatch(
                  view.state.tr.setMeta(blockKey, { selected: null } satisfies Action).setMeta("addToHistory", false),
                );
            };
            const outside = (event: Event) => {
              if (
                menu &&
                !menu.contains(event.target as globalThis.Node) &&
                !handle.contains(event.target as globalThis.Node) &&
                !insertPanel?.contains(event.target as globalThis.Node) &&
                !(
                  insertPanel &&
                  event.target instanceof (win?.Element ?? Element) &&
                  (event.target as Element).closest(".semlo-editor-table-grid-popover,.semlo-editor-column-picker")
                )
              )
                closeMenu();
            };
            const closeDrag = () => {
              drag = null;
              indicator.hidden = true;
              handle.classList.remove("is-dragging");
            };
            const setStatus = (text: string) => {
              const status = menu?.querySelector<HTMLElement>(".semlo-editor-block-menu-status");
              if (status) status.textContent = text;
            };
            const { positionMenu, menuItem, moveMenuFocus } = createBlockMenuHelpers(doc, win);
            const executeConversion = (item: Conversion) => {
              if (!target || !editor.isEditable) return;
              if (target.kind === "item" && (item.type === "heading" || item.type === "paragraph")) {
                if (view.composing) return;
                const range = listGroupTextRange(view.state, target);
                if (!range) {
                  setStatus("当前块无法无损转换");
                  if (item.type === "paragraph" && !editor.isDestroyed) view.focus();
                  return;
                }
                const preserveInlineMarks =
                  item.type === "paragraph" && view.state.doc.nodeAt(target.parentPos)?.type.name === "orderedList";
                const changed = setHeadingStyle(editor, item.type === "heading" ? (item.level ?? 0) : 0, {
                  preserveInlineMarks,
                  selection: range,
                  focus: false,
                });
                if (!changed && !editor.isDestroyed) {
                  setStatus("当前块无法无损转换");
                  if (item.type === "paragraph") view.focus();
                  return;
                }
                closeMenu();
                if (changed && !editor.isDestroyed) {
                  const $from = view.state.selection.$from;
                  if ($from.parent.isTextblock)
                    view.dispatch(
                      view.state.tr
                        .setSelection(TextSelection.create(view.state.doc, $from.start()))
                        .setMeta("addToHistory", false),
                    );
                }
                if (!editor.isDestroyed) view.focus();
                return;
              }
              if (
                target.kind === "item" &&
                (item.type === "bulletList" || item.type === "orderedList" || item.type === "taskList")
              ) {
                const range = listGroupTextRange(view.state, target);
                const list = view.state.doc.nodeAt(target.parentPos);
                if (!range || list?.type.name === item.type) {
                  setStatus("当前块无法无损转换");
                  return;
                }
                const style = item.type === "orderedList" ? preferredOrderedStyle(editor) : null;
                const changed = convertOneTask(
                  editor,
                  item.type,
                  style ? { semloEditorOrderedStyle: style } : null,
                  range,
                );
                if (!changed) {
                  setStatus("当前块无法无损转换");
                  return;
                }
                closeMenu();
                return;
              }
              const unwrap = item.type === "blockquote" ? linkedQuoteUnwrap(view.state, target) : null;
              if (unwrap) {
                closeMenu();
                const tr = view.state.tr.replaceWith(unwrap.from, unwrap.to, unwrap.node);
                tr.setSelection(
                  Selection.near(tr.doc.resolve(Math.min(unwrap.selection, tr.doc.content.size)), 1),
                ).scrollIntoView();
                dispatchChange(editor, tr);
                if (!editor.isDestroyed) view.focus();
                return;
              }
              const codePlan = item.type === "codeBlock" ? listGroupCodePlan(view.state, target) : null;
              if (codePlan) {
                closeMenu();
                const tr = view.state.tr.replaceWith(codePlan.from, codePlan.to, codePlan.content);
                tr.setSelection(Selection.near(tr.doc.resolve(codePlan.selection), 1)).scrollIntoView();
                dispatchChange(editor, tr);
                if (!editor.isDestroyed) view.focus();
                return;
              }
              const quotePlan =
                item.type === "blockquote" ||
                item.type === "callout" ||
                item.type === "semloEditorColumns" ||
                item.type === "details"
                  ? listItemWrapper(view.state, target, item.type)
                  : null;
              if (quotePlan) {
                closeMenu();
                const tr = view.state.tr.replaceWith(quotePlan.from, quotePlan.to, quotePlan.content);
                tr.setSelection(
                  Selection.near(tr.doc.resolve(Math.min(quotePlan.selection, tr.doc.content.size)), 1),
                ).scrollIntoView();
                dispatchChange(editor, tr);
                if (!editor.isDestroyed) view.focus();
                return;
              }
              const next = replacement(view.state, target, item),
                previous = view.state.doc.nodeAt(target.pos);
              if (!next || previous !== target.node) {
                setStatus("当前块无法无损转换");
                return;
              }
              const pos = target.pos;
              closeMenu();
              let tr = view.state.tr.replaceWith(pos, pos + previous.nodeSize, next);
              tr = tr
                .setSelection(Selection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)), 1))
                .scrollIntoView();
              dispatchChange(editor, tr);
              if (!editor.isDestroyed) view.focus();
            };
            const openSubmenu = (trigger: HTMLButtonElement, kind: "convert" | "indent", focusPanel = true) => {
              if (!menu || !target) return;
              cancelSubmenuTimer();
              closeInsert?.();
              if (submenu && trigger.getAttribute("aria-expanded") === "true") {
                if (focusPanel) submenu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
                return;
              }
              submenu?.remove();
              menu
                .querySelectorAll("[aria-expanded=true]")
                .forEach((element) => element.setAttribute("aria-expanded", "false"));
              submenu = doc.createElement("div");
              submenu.className = "semlo-editor-block-submenu";
              submenu.setAttribute("role", "menu");
              submenu.setAttribute("aria-label", kind === "convert" ? "转化为" : "缩进");
              const panel = submenu;
              panel.addEventListener("mouseenter", cancelSubmenuTimer);
              if (kind === "convert") {
                let unavailable = false;
                const available = conversions;
                for (const item of available) {
                  const wrapper =
                    item.type === "blockquote" ||
                    item.type === "callout" ||
                    item.type === "semloEditorColumns" ||
                    item.type === "details"
                      ? listItemWrapper(view.state, target, item.type)
                      : null;
                  const headingGroup =
                    target.kind === "item" &&
                    (item.type === "heading" || item.type === "paragraph") &&
                    listGroupTextRange(view.state, target);
                  const listGroup =
                    target.kind === "item" &&
                    ["bulletList", "orderedList", "taskList"].includes(item.type) &&
                    view.state.doc.nodeAt(target.parentPos)?.type.name !== item.type &&
                    listGroupTextRange(view.state, target);
                  const codePlan = item.type === "codeBlock" && listGroupCodePlan(view.state, target);
                  const unwrap = item.type === "blockquote" && linkedQuoteUnwrap(view.state, target);
                  const disabled =
                    !replacement(view.state, target, item) &&
                    !wrapper &&
                    !headingGroup &&
                    !listGroup &&
                    !codePlan &&
                    !unwrap;
                  unavailable ||= disabled;
                  menuItem(panel, item.label, () => executeConversion(item), disabled);
                }
                if (unavailable) {
                  const note = doc.createElement("div");
                  note.className = "semlo-editor-block-submenu-note";
                  note.setAttribute("role", "note");
                  note.textContent = "灰色选项暂不支持当前块或会丢失格式";
                  panel.append(note);
                }
              } else {
                for (const [label, delta] of [
                  ["增加缩进", 1],
                  ["减少缩进", -1],
                ] as const)
                  menuItem(
                    panel,
                    label,
                    () => {
                      if (!target || !editor.isEditable || view.state.doc.nodeAt(target.pos) !== target.node) return;
                      const pos = target.pos + (target.kind === "item" ? 2 : 1);
                      closeMenu();
                      editor.commands.setTextSelection(Math.min(pos, editor.state.doc.content.size));
                      view.dispatch(closeHistory(view.state.tr));
                      adjustParagraphIndent(editor, delta);
                      if (!editor.isDestroyed) {
                        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
                        view.focus();
                      }
                    },
                    !(target.kind === "item" || ["paragraph", "heading"].includes(target.node.type.name)),
                  );
              }
              panel.addEventListener("keydown", (event) => {
                if (event.key === "Escape" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelSubmenuTimer();
                  panel.remove();
                  submenu = null;
                  trigger.setAttribute("aria-expanded", "false");
                  trigger.focus();
                  return;
                }
                moveMenuFocus(event, panel);
              });
              menu.append(panel);
              trigger.setAttribute("aria-expanded", "true");
              positionMenu(panel, trigger.getBoundingClientRect(), true);
              if (focusPanel) panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
            };
            const copyOrCut = async (cut: boolean) => {
              if (!target || writing || !editor.isEditable) return;
              const selected = target,
                contents = clipboardContents(editor, selected),
                originalDoc = view.state.doc;
              if (!contents) {
                setStatus("当前块无法复制");
                return;
              }
              const currentMenu = menu,
                version = ++writeVersion;
              writing = true;
              const result = await writeClipboard(doc, contents);
              if (destroyed || !menu || menu !== currentMenu || version !== writeVersion) return;
              writing = false;
              if (result === "failed") {
                setStatus("复制失败，请检查剪贴板权限");
                return;
              }
              if (result === "plain") {
                setStatus(cut ? "浏览器仅允许复制纯文本，未剪切以保留格式" : "已复制纯文本，未包含格式");
                return;
              }
              if (cut && (view.state.doc !== originalDoc || !editor.isEditable || !deleteTarget(editor, selected))) {
                setStatus("当前块无法安全剪切");
                return;
              }
              closeMenu();
            };
            const openMenu = () => {
              if (!target || !editor.isEditable || view.state.doc.nodeAt(target.pos) !== target.node) return;
              if (menu) {
                closeMenu();
                return;
              }
              view.dispatch(
                view.state.tr
                  .setMeta(blockKey, { selected: target.pos } satisfies Action)
                  .setMeta("addToHistory", false),
              );
              menu = doc.createElement("div");
              menu.className = "semlo-editor-block-menu";
              menu.setAttribute("role", "menu");
              menu.setAttribute("aria-label", "块操作");
              const panel = menu;
              const separator = () => {
                const line = doc.createElement("div");
                line.className = "semlo-editor-block-menu-separator";
                line.setAttribute("role", "separator");
                panel.append(line);
              };
              const convert = menuItem(panel, "转化为", () => openSubmenu(convert, "convert"), false, true);
              convert.addEventListener("mouseenter", () => onMenuHover(() => openSubmenu(convert, "convert", false)));
              separator();
              menuItem(panel, "删除", () => {
                if (target) {
                  const selected = target;
                  if (deleteTarget(editor, selected)) closeMenu();
                  else setStatus("当前块无法安全删除");
                }
              });
              menuItem(panel, "复制", () => {
                void copyOrCut(false);
              });
              menuItem(panel, "剪切", () => {
                void copyOrCut(true);
              });
              separator();
              const indent = menuItem(panel, "缩进", () => openSubmenu(indent, "indent"), false, true);
              indent.addEventListener("mouseenter", () => onMenuHover(() => openSubmenu(indent, "indent", false)));
              separator();
              const showInsert = (focusPanel: boolean) => {
                if (!target || !menu || !options.openInsertBelow) return;
                cancelSubmenuTimer();
                if (closeInsert) {
                  if (focusPanel) insertPanel?.focus({ preventScroll: true });
                  return;
                }
                const selected = target,
                  selection = view.state.selection.getBookmark();
                if (view.state.doc.nodeAt(selected.pos) !== selected.node) return;
                submenu?.remove();
                submenu = null;
                panel
                  .querySelectorAll("[aria-expanded=true]")
                  .forEach((element) => element.setAttribute("aria-expanded", "false"));
                closeInsert = options.openInsertBelow(editor, {
                  pos: selected.pos,
                  after: selected.pos + selected.node.nodeSize,
                  kind: selected.kind,
                  node: selected.node,
                  anchor: menu,
                  trigger: insert,
                  focusPanel,
                  onOpen: (element) => {
                    insertPanel = element;
                  },
                  onClose: () => {
                    insertPanel = null;
                    closeInsert = undefined;
                  },
                  closeMenu,
                  selection,
                });
              };
              const insert = menuItem(panel, "在下方添加", () => showInsert(true), !options.openInsertBelow, true);
              insert.addEventListener("mouseenter", () => onMenuHover(() => showInsert(false)));
              insert.setAttribute("aria-haspopup", "dialog");
              for (const row of panel.querySelectorAll<HTMLButtonElement>(":scope > button")) {
                if (row === convert || row === indent || row === insert) continue;
                row.addEventListener("mouseenter", () =>
                  onMenuHover(() => {
                    closeInsert?.();
                    submenu?.remove();
                    submenu = null;
                    panel
                      .querySelectorAll("[aria-expanded=true]")
                      .forEach((element) => element.setAttribute("aria-expanded", "false"));
                  }),
                );
              }
              panel.addEventListener("pointerdown", (event) => {
                if (closeInsert && !insert.contains(event.target as globalThis.Node)) closeInsert();
              });
              const status = doc.createElement("div");
              status.className = "semlo-editor-block-menu-status";
              status.setAttribute("role", "status");
              panel.append(status);
              panel.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelSubmenuTimer();
                  if (closeInsert) {
                    closeInsert();
                    insert.focus({ preventScroll: true });
                  } else if (submenu) {
                    submenu.remove();
                    submenu = null;
                    panel.querySelector("[aria-expanded=true]")?.setAttribute("aria-expanded", "false");
                  } else {
                    closeMenu();
                    handle.focus();
                  }
                  return;
                }
                if (event.key === "ArrowRight" && doc.activeElement === convert) {
                  event.preventDefault();
                  openSubmenu(convert, "convert");
                  return;
                }
                if (event.key === "ArrowRight" && doc.activeElement === indent) {
                  event.preventDefault();
                  openSubmenu(indent, "indent");
                  return;
                }
                if (event.key === "ArrowRight" && doc.activeElement === insert) {
                  event.preventDefault();
                  insert.click();
                  return;
                }
                moveMenuFocus(event, panel);
              });
              doc.body.append(panel);
              handle.setAttribute("aria-expanded", "true");
              positionMenu(panel, handle.getBoundingClientRect());
              const blockRect = (target.heading ?? target.dom).getBoundingClientRect(),
                handleRect = handle.getBoundingClientRect();
              menuOffset = { x: handleRect.left - blockRect.left, y: handleRect.top - blockRect.top };
              panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
            };
            const { dragStart, dragOver, drop } = createBlockDrag({
              editor,
              view,
              win,
              handle,
              indicator,
              getDrag: () => drag,
              setDrag: (value) => {
                drag = value;
              },
              getTarget: () => target,
              getRootEntries: () => rootEntries,
              resolveElement,
              closeMenu,
              closeDrag,
            });
            const editableChanged = () => {
              if (!editor.isEditable) {
                closeMenu();
                closeDrag();
                target = null;
                handle.hidden = true;
              }
              scheduleLayout();
            };
            const resizeObserver = win?.ResizeObserver ? new win.ResizeObserver(reposition) : null;
            resizeObserver?.observe(view.dom);
            if (view.dom.parentElement) resizeObserver?.observe(view.dom.parentElement);
            handle.addEventListener("click", openMenu);
            handle.addEventListener("dragstart", dragStart);
            handle.addEventListener("dragend", closeDrag);
            view.dom.addEventListener("dragover", dragOver);
            view.dom.addEventListener("drop", drop);
            view.dom.addEventListener("focus", focus, true);
            view.dom.addEventListener("semlo-editor:editable", editableChanged);
            doc.addEventListener("pointermove", pointerMove, true);
            doc.addEventListener("pointerdown", outside, true);
            doc.addEventListener("scroll", reposition, true);
            win?.addEventListener("resize", reposition);
            indexRoots();
            scheduleLayout();
            if (view.hasFocus()) focus();
            return {
              update(next, previous) {
                if (previous.doc !== next.state.doc) {
                  closeMenu(false);
                  closeDrag();
                  target = null;
                  handle.hidden = true;
                  indexRoots();
                } else if (next.hasFocus() && !menu && !drag) focus();
                if (!editor.isEditable) editableChanged();
                scheduleLayout();
              },
              destroy() {
                destroyed = true;
                resizeObserver?.disconnect();
                if (layoutFrame !== undefined) win?.cancelAnimationFrame(layoutFrame);
                clearHide();
                closeMenu(false);
                closeDrag();
                handle.remove();
                indicator.remove();
                view.dom.removeEventListener("dragover", dragOver);
                view.dom.removeEventListener("drop", drop);
                view.dom.removeEventListener("focus", focus, true);
                view.dom.removeEventListener("semlo-editor:editable", editableChanged);
                doc.removeEventListener("pointermove", pointerMove, true);
                doc.removeEventListener("pointerdown", outside, true);
                doc.removeEventListener("scroll", reposition, true);
                win?.removeEventListener("resize", reposition);
              },
            };
          },
        }),
      ];
    },
  });
}
