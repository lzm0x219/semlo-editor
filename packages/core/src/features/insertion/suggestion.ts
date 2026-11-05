import { Extension, type Editor, type Range } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion } from "@tiptap/suggestion";

import {
  unavailableBlockCommands,
  matchingCommands,
  searchableQuickCommands,
  recentCommands,
  invoke,
  type CommandItem,
  type InteractiveKind,
  type InteractiveAction,
} from "./commands";
import { slashSuggestionKey } from "./keys";
import {
  positionMenu,
  paintPanel,
  highlightCommand,
  nextCommand,
  addTableGrid,
  addColumnPicker,
  type PanelEntry,
} from "./menu";
import {
  filterInsertCommands,
  isDetailsBodyInsert,
  isInsertCommandAllowed,
  isTableCellQuickSuppressed,
  isTableCellSlashSuppressed,
} from "./toolbar-insert-context";
import { isHeadingSlashSuppressed } from "./toolbar-slash-heading-context";
import { isListSlashSuppressed } from "./toolbar-slash-list-context";
import {
  isCardParagraphSlashSuppressed,
  isQuoteParagraphSlashSuppressed,
  isRootParagraphSlashSuppressed,
} from "./toolbar-slash-paragraph-context";

const slashViews = new WeakMap<
  Editor,
  {
    invalidate: (document: ProseMirrorNode, range: Range, text: string) => void;
    isInvalidated: (document: ProseMirrorNode) => boolean;
    isSuppressed: (range: Range, text: string) => boolean;
    reconcile: (transaction: Transaction) => void;
  }
>();

/** 在宿主事务监听器执行之前，使旧菜单立即失效。 */
export function invalidateSlashSuggestion(
  editor: Editor,
  document: ProseMirrorNode,
  range: Range,
  text: string,
): boolean {
  const view = slashViews.get(editor);
  if (!view) return false;
  view.invalidate(document, range, text);
  return true;
}

export function slashSuggestionIsInvalidated(editor: Editor, document: ProseMirrorNode): boolean {
  return slashViews.get(editor)?.isInvalidated(document) ?? false;
}

export function reconcileSlashInvalidation(editor: Editor, transaction: Transaction) {
  slashViews.get(editor)?.reconcile(transaction);
}

export function closeSlashSuggestion(editor: Editor) {
  exitSuggestion(editor.view, slashSuggestionKey);
}
export function slashCommands(
  openImage: () => void,
  openAttachment: () => void,
  openEmoji: () => void,
  openMedia: (kind: "video" | "audio") => void,
  openLink: (range?: Range) => void,
  openMenu: () => void,
  openInteractive: InteractiveAction,
  interactiveAvailable: (kind: InteractiveKind) => boolean,
) {
  return Extension.create({
    name: "semloEditorSlash",
    addKeyboardShortcuts() {
      return {
        "Mod-/": () => {
          if (!this.editor.isEditable) return false;
          openMenu();
          return true;
        },
      };
    },
    addProseMirrorPlugins() {
      return [
        Suggestion<CommandItem>({
          editor: this.editor,
          pluginKey: slashSuggestionKey,
          char: "/",
          startOfLine: true,
          shouldResetDismissed: ({ transaction, match }) =>
            transaction.docChanged && transaction.getMeta("semloEditorSlashReopen") === match.range.from,
          shouldShow: ({ editor, range, text, transaction }) =>
            transaction.getMeta("semloEditorSlashReopen") === range.from ||
            !slashViews.get(editor)?.isSuppressed(range, text),
          allow: ({ state, range }) => {
            const position = state.doc.resolve(range.from);
            if (position.parent.type.spec.code) return false;
            if (isListSlashSuppressed(state, range)) return false;
            if (isHeadingSlashSuppressed(state, range)) return false;
            if (isRootParagraphSlashSuppressed(state, range)) return false;
            if (isQuoteParagraphSlashSuppressed(state, range)) return false;
            if (isCardParagraphSlashSuppressed(state, range)) return false;
            if (isTableCellSlashSuppressed(state, range)) return false;
            for (let depth = position.depth; depth > 0; depth--)
              if (position.node(depth).type.name === "detailsSummary") return false;
            return true;
          },
          items: ({ query, editor }) =>
            filterInsertCommands(editor.state, [
              ...searchableQuickCommands(openLink, query),
              ...matchingCommands(
                openImage,
                openAttachment,
                openEmoji,
                openMedia,
                query,
                openInteractive,
                interactiveAvailable,
              ),
              ...unavailableBlockCommands().filter((item) =>
                item.key.toLowerCase().includes(query.trim().toLowerCase()),
              ),
            ]),
          command: ({ editor, range, props }) => {
            if (!isInsertCommandAllowed(editor.state, props.id, range.from)) return;
            if (props.id === "vote" || props.id === "checkin" || props.id === "yuque" || props.id === "encrypted")
              exitSuggestion(editor.view, slashSuggestionKey);
            invoke(props, editor, range);
          },
          render: () => {
            let menu: HTMLDivElement | undefined;
            let current: CommandItem[] = [];
            let enabled: PanelEntry[] = [];
            let choose: ((item: CommandItem) => void) | undefined;
            let lastRect: DOMRect | null = null;
            let range: Range | undefined;
            let query = "";
            let loading = false;
            let removeGrid: (() => void) | undefined;
            let removeColumns: (() => void) | undefined;
            let selected = 0;
            let selectedByNavigation = false;
            let drawRevision = 0;
            let invalidatedDocument: ProseMirrorNode | null = null;
            // 文档等价重建后，保留失效的匹配信息，避免旧菜单重新出现。
            let invalidatedMatch: { from: number; text: string } | null = null;
            const cleanup = () => {
              drawRevision++;
              removeGrid?.();
              removeColumns?.();
              removeGrid = undefined;
              removeColumns = undefined;
              menu?.remove();
              menu = undefined;
            };
            slashViews.set(this.editor, {
              invalidate: (document, range, text) => {
                invalidatedDocument = document;
                invalidatedMatch = { from: range.from, text };
                choose = undefined;
                cleanup();
              },
              isInvalidated: (document) => invalidatedDocument === document,
              isSuppressed: (range, text) => invalidatedMatch?.from === range.from && invalidatedMatch.text === text,
              reconcile: (transaction) => {
                if (!invalidatedMatch) return;
                const { from, text } = invalidatedMatch;
                const { doc, selection } = this.editor.state;
                if (
                  transaction.getMeta("preventUpdate") ||
                  transaction.getMeta("semloEditorSlashReopen") === from ||
                  from >= doc.content.size ||
                  doc.textBetween(from, from + 1) !== "/" ||
                  (!transaction.docChanged &&
                    transaction.selectionSet &&
                    (selection.from < from || selection.from > from + text.length))
                )
                  invalidatedMatch = null;
              },
            });
            const mountMenu = (editor: Editor) => {
              menu = editor.view.dom.ownerDocument.createElement("div");
              menu.className = "semlo-editor-slash-menu";
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", "插入内容");
              editor.view.dom.ownerDocument.body.append(menu);
            };
            const draw = () => {
              if (!menu) return;
              const revision = ++drawRevision;
              const isCurrent = () => revision === drawRevision && !!menu;
              removeGrid?.();
              removeColumns?.();
              if (query.trim() && !current.length && !isDetailsBodyInsert(this.editor.state, range?.from)) {
                enabled = [];
                menu.hidden = true;
                if (!loading && !this.editor.isDestroyed) {
                  cleanup();
                  exitSuggestion(this.editor.view, slashSuggestionKey);
                }
                return;
              }
              menu.hidden = false;
              enabled = paintPanel({
                editor: this.editor,
                menu,
                items: current,
                range,
                quick:
                  !query.trim() &&
                  !isDetailsBodyInsert(this.editor.state, range?.from) &&
                  !isTableCellQuickSuppressed(this.editor.state, range?.from),
                search: Boolean(query.trim()),
                openLink,
                recents: query.trim()
                  ? []
                  : recentCommands(
                      this.editor,
                      openImage,
                      openAttachment,
                      openEmoji,
                      openMedia,
                      openLink,
                      openInteractive,
                      interactiveAvailable,
                    ),
                onRecent: (item) => {
                  if (isCurrent()) choose?.(item);
                },
                onHighlight: (button) => {
                  if (!isCurrent()) return;
                  const index = enabled.findIndex((candidate) => candidate.button === button);
                  if (index < 0 || !menu) return;
                  selected = index;
                  highlightCommand(enabled, selected);
                },
                onChoose: (item) => {
                  if (!isCurrent()) return;
                  if (item.id === "table") return;
                  if (!item.disabled) choose?.(item);
                },
                onQuick: (run) => {
                  if (isCurrent() && range) {
                    const currentRange = range;
                    cleanup();
                    run(this.editor, currentRange);
                  }
                },
              });
              selected = Math.min(selected, enabled.length - 1);
              highlightCommand(enabled, selected);
              removeGrid = addTableGrid(
                menu,
                this.editor,
                range,
                cleanup,
                () => removeColumns?.(),
                () => isCurrent() && isInsertCommandAllowed(this.editor.state, "table", range?.from),
              );
              removeColumns = addColumnPicker(
                menu,
                this.editor,
                range,
                cleanup,
                () => removeGrid?.(),
                () => isCurrent() && isInsertCommandAllowed(this.editor.state, "columns", range?.from),
              );
              positionMenu(menu, lastRect);
            };
            return {
              onStart: (props) => {
                if (invalidatedDocument === props.editor.state.doc) return;
                invalidatedDocument = null;
                mountMenu(props.editor);
                current = props.items;
                selected = 0;
                selectedByNavigation = false;
                choose = props.command;
                lastRect = props.clientRect?.() ?? null;
                range = props.range;
                query = props.query;
                loading = props.loading;
                draw();
              },
              onUpdate: (props) => {
                if (invalidatedDocument === props.editor.state.doc) return;
                invalidatedDocument = null;
                if (!menu) mountMenu(props.editor);
                current = props.items;
                selected = 0;
                selectedByNavigation = false;
                choose = props.command;
                lastRect = props.clientRect?.() ?? null;
                range = props.range;
                query = props.query;
                loading = props.loading;
                draw();
              },
              onKeyDown: ({ event }) => {
                if (event.key === "Escape") {
                  cleanup();
                  return true;
                }
                const normalizedQuery = query.trim().toLowerCase();
                if (
                  event.key === "Enter" &&
                  !selectedByNavigation &&
                  current.some(
                    (item) =>
                      item.disabled &&
                      (item.id === normalizedQuery ||
                        item.shortcut?.replace(/^\//, "").toLowerCase() === normalizedQuery),
                  )
                )
                  return true;
                if (!enabled.length) {
                  if (event.key === "Enter" && current.some((item) => item.disabled)) return true;
                  if (event.key === "Enter" && isDetailsBodyInsert(this.editor.state, range?.from)) {
                    cleanup();
                    exitSuggestion(this.editor.view, slashSuggestionKey);
                    return true;
                  }
                  return false;
                }
                if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp" ||
                  ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selected >= 0)
                ) {
                  const direction = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" }[
                    event.key
                  ] as "up" | "down" | "left" | "right";
                  selected = nextCommand(enabled, selected, direction);
                  selectedByNavigation = true;
                  highlightCommand(enabled, selected, true);
                  return true;
                }
                if (event.key === "Enter") {
                  choose?.(enabled[selected].item);
                  return true;
                }
                return false;
              },
              onExit: cleanup,
            };
          },
        }),
      ];
    },
  });
}
