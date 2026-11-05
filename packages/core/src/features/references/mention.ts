import { Extension, Node, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion, findSuggestionMatch, type SuggestionProps } from "@tiptap/suggestion";

import { linkPopup } from "../../platform/dom/popup-owner";
import { addDays, dateLabel, todayISO } from "../../shared/date/date-utils";
import type { MentionItem, MentionSearch } from "../../types";

const mentionKey = new PluginKey("semloEditorMention");
const refreshMentionMeta = "semlo-editor:refresh-mention";
const forcedTriggers = new WeakMap<Editor, number>();

/** The insert menu must work even when the cursor follows non-whitespace text. */
export function insertMentionTrigger(editor: Editor, range?: { from: number; to: number }) {
  const position = range?.from ?? editor.state.selection.from;
  forcedTriggers.set(editor, position);
  const chain = editor.chain().focus();
  if (range) chain.deleteRange(range);
  if (!chain.insertContent("@").run()) forcedTriggers.delete(editor);
}
function safeURL(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    if (["http:", "https:"].includes(new URL(trimmed).protocol)) return trimmed;
  } catch {
    /* invalid */
  }
  return null;
}
function validItems(value: unknown): MentionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        item.label.trim() &&
        ["person", "document"].includes(item.kind),
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      ...(safeURL(item.href) ? { href: safeURL(item.href)! } : {}),
    }));
}
export const Mention = Node.create({
  name: "semloEditorMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-id") ?? "" },
      label: { default: "", rendered: false, parseHTML: (el) => el.getAttribute("data-label") ?? "" },
      kind: {
        default: "person",
        rendered: false,
        parseHTML: (el) => (el.getAttribute("data-kind") === "document" ? "document" : "person"),
      },
      href: { default: null, rendered: false, parseHTML: (el) => safeURL(el.getAttribute("data-href")) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-semlo-editor-mention]" }];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
  renderHTML({ node }) {
    const href = safeURL(node.attrs.href);
    return [
      "span",
      {
        "data-semlo-editor-mention": "",
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
        "data-kind": node.attrs.kind,
        class: "semlo-editor-mention",
        ...(href ? { "data-href": href } : {}),
      },
      `@${node.attrs.label}`,
    ];
  },
  addNodeView() {
    return ({ node: initial, view }) => {
      const doc = view.dom.ownerDocument,
        dom = doc.createElement("span");
      dom.className = "semlo-editor-mention-node";
      dom.contentEditable = "false";
      let current = initial;
      const paint = () => {
        dom.replaceChildren();
        const href = safeURL(current.attrs.href);
        const label = `@${current.attrs.label}`;
        if (href) {
          const link = doc.createElement("a");
          link.className = "semlo-editor-mention";
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = label;
          dom.append(link);
        } else {
          const text = doc.createElement("span");
          text.className = "semlo-editor-mention";
          text.textContent = label;
          dom.append(text);
        }
      };
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          current = node;
          paint();
          return true;
        },
        stopEvent(event) {
          return (event.target as Element).closest?.("a") != null;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
type Choice = { type: "mention"; item: MentionItem } | { type: "date"; date: string; custom?: boolean };
function quickDates(): Array<{ label: string; detail: string; choice: Choice }> {
  const today = todayISO(),
    week = addDays(today, 7);
  return [
    { label: dateLabel(today), detail: "今天", choice: { type: "date", date: today } },
    { label: dateLabel(week), detail: "下周", choice: { type: "date", date: week } },
    { label: "自定义日期", detail: "", choice: { type: "date", date: today, custom: true } },
  ];
}
function insertChoice(editor: Editor, range: { from: number; to: number }, choice: Choice) {
  if (choice.type === "mention") {
    editor.chain().focus().deleteRange(range).insertContent({ type: "semloEditorMention", attrs: choice.item }).run();
    return;
  }
  const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: "semloEditorDate", attrs: { date: choice.date, id } })
    .run();
  if (choice.custom) {
    const target = editor.view.dom.querySelector<HTMLElement>(`[data-date-id="${id}"]`);
    target?.dispatchEvent(new (editor.view.dom.ownerDocument.defaultView?.Event ?? Event)("semlo-editor:open-date"));
  }
}
/** Re-run an open suggestion when its provider changes, aborting the previous request. */
export function refreshMentionSuggestion(editor: Editor) {
  if (editor.isDestroyed || !mentionKey.getState(editor.state)?.active) return;
  exitSuggestion(editor.view, mentionKey);
  if (!editor.isDestroyed)
    editor.view.dispatch(editor.state.tr.setMeta(refreshMentionMeta, true).setMeta("addToHistory", false));
}

export function mentionSuggestion(getSearch: () => MentionSearch | undefined, report: (error: unknown) => void) {
  return Extension.create({
    name: "semloEditorMentionSuggestion",
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion<MentionItem, Choice>({
          editor,
          pluginKey: mentionKey,
          char: "@",
          debounce: 120,
          findSuggestionMatch: (config) => {
            const normal = findSuggestionMatch(config);
            if (normal) return normal;
            const forced = findSuggestionMatch({ ...config, allowedPrefixes: null });
            return forced?.range.from === forcedTriggers.get(editor) ? forced : null;
          },
          allow: ({ state, range }) => editor.isEditable && !state.doc.resolve(range.from).parent.type.spec.code,
          shouldResetDismissed: ({ transaction }) => Boolean(transaction.getMeta(refreshMentionMeta)),
          items: async ({ query, signal }) => {
            const search = getSearch();
            if (!search) return [];
            try {
              const result = await search(query, signal);
              return signal.aborted || search !== getSearch() ? [] : validItems(result);
            } catch (error) {
              if (!signal.aborted && search === getSearch()) report(error);
              return [];
            }
          },
          command: ({ editor, range, props }) => insertChoice(editor, range, props),
          render: () => {
            let panel: HTMLDivElement | undefined;
            let viewDOM: HTMLElement | undefined;
            let current: SuggestionProps<MentionItem, Choice> | undefined;
            let kind: "all" | "person" | "document" = "all";
            let selected = 0;
            let choices: Choice[] = [];
            let drawRevision = 0;
            let unlinkPopup: (() => void) | undefined;
            let previousActive: string | null = null;
            let ownedActive: string | undefined;
            const clearActive = () => {
              if (viewDOM && ownedActive && viewDOM.getAttribute("aria-activedescendant") === ownedActive) {
                if (previousActive === null) viewDOM.removeAttribute("aria-activedescendant");
                else viewDOM.setAttribute("aria-activedescendant", previousActive);
              }
              ownedActive = undefined;
            };
            const cleanup = () => {
              const doc = panel?.ownerDocument ?? viewDOM?.ownerDocument;
              clearActive();
              unlinkPopup?.();
              unlinkPopup = undefined;
              panel?.remove();
              panel = undefined;
              doc?.removeEventListener("pointerdown", outside, true);
              viewDOM?.removeEventListener("semlo-editor:editable", editableChanged);
              viewDOM = undefined;
              forcedTriggers.delete(editor);
            };
            const outside = (event: Event) => {
              if (panel && !panel.contains(event.target as globalThis.Node)) exitSuggestion(editor.view, mentionKey);
            };
            const editableChanged = () => {
              if (!editor.isEditable) exitSuggestion(editor.view, mentionKey);
            };
            const choose = (choice: Choice) => current?.command(choice);
            const draw = () => {
              if (!panel || !current) return;
              const doc = panel.ownerDocument;
              panel.replaceChildren();
              choices = [];
              if (!current.query) {
                const caption = doc.createElement("div");
                caption.className = "semlo-editor-mention-section";
                caption.textContent = "日期";
                panel.append(caption);
                for (const quick of quickDates()) {
                  const row = doc.createElement("button");
                  row.type = "button";
                  row.className = "semlo-editor-mention-row";
                  row.setAttribute("role", "option");
                  row.setAttribute("aria-label", quick.detail ? `${quick.label} ${quick.detail}` : quick.label);
                  row.textContent = `▣ ${quick.label}${quick.detail ? `  ${quick.detail}` : ""}`;
                  row.addEventListener("mousedown", (event) => event.preventDefault());
                  row.addEventListener("click", () => choose(quick.choice));
                  panel.append(row);
                  choices.push(quick.choice);
                }
              }
              const top = doc.createElement("div");
              top.className = "semlo-editor-mention-top";
              const title = doc.createElement("span");
              title.textContent = "提及人或内容";
              top.append(title);
              for (const [value, label] of [
                ["person", "人"],
                ["document", "内容"],
              ] as const) {
                const tab = doc.createElement("button");
                tab.type = "button";
                tab.textContent = label;
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-selected", String(kind === value));
                tab.addEventListener("mousedown", (event) => event.preventDefault());
                tab.addEventListener("click", () => {
                  kind = value;
                  selected = 0;
                  draw();
                });
                top.append(tab);
              }
              panel.append(top);
              const matched = current.items.filter((item) => kind === "all" || item.kind === kind);
              if (!matched.length) {
                const empty = doc.createElement("div");
                empty.className = "semlo-editor-mention-empty";
                empty.textContent = current.loading
                  ? "正在搜索…"
                  : !getSearch()
                    ? "未配置提及搜索"
                    : "无匹配内容，请重新输入";
                panel.append(empty);
              }
              for (const item of matched) {
                const choice: Choice = { type: "mention", item };
                const row = doc.createElement("button");
                row.type = "button";
                row.className = "semlo-editor-mention-row";
                row.setAttribute("role", "option");
                row.setAttribute("aria-label", item.label);
                row.textContent = `${item.kind === "person" ? "◉" : "▤"}  ${item.label}`;
                row.addEventListener("mousedown", (event) => event.preventDefault());
                row.addEventListener("click", () => choose(choice));
                panel.append(row);
                choices.push(choice);
              }
              const rows = panel.querySelectorAll<HTMLElement>('[role="option"]');
              const optionPrefix = `${panel.id}-option-${++drawRevision}`;
              rows.forEach((row, index) => {
                row.id = `${optionPrefix}-${index}`;
                row.classList.toggle("is-selected", index === selected);
                row.setAttribute("aria-selected", String(index === selected));
              });
              const active = rows[selected];
              if (viewDOM && active) {
                const currentActive = viewDOM.getAttribute("aria-activedescendant");
                if (!ownedActive || currentActive !== ownedActive) previousActive = currentActive;
                viewDOM.setAttribute("aria-activedescendant", active.id);
                ownedActive = active.id;
              } else clearActive();
              const rect = current.clientRect?.();
              if (rect) {
                const viewport = doc.defaultView;
                panel.style.left = `${Math.max(8, Math.min(rect.left, (viewport?.innerWidth ?? 1000) - 360))}px`;
                const height = panel.offsetHeight || 260;
                panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, (viewport?.innerHeight ?? 800) - height - 8))}px`;
              }
            };
            return {
              onStart: (props) => {
                current = props;
                kind = "all";
                selected = 0;
                viewDOM = props.editor.view.dom;
                const doc = viewDOM.ownerDocument;
                panel = doc.createElement("div");
                panel.className = "semlo-editor-mention-menu";
                panel.setAttribute("role", "listbox");
                panel.setAttribute("aria-label", "提及");
                doc.body.append(panel);
                // 编辑器保留输入焦点时，通过控件关系暴露当前候选项。
                unlinkPopup = linkPopup(viewDOM, panel);
                doc.addEventListener("pointerdown", outside, true);
                viewDOM.addEventListener("semlo-editor:editable", editableChanged);
                draw();
              },
              onUpdate: (props) => {
                current = props;
                selected = 0;
                draw();
              },
              onExit: cleanup,
              onKeyDown: ({ event }) => {
                if (event.key === "Escape") {
                  exitSuggestion(editor.view, mentionKey);
                  return true;
                }
                if (!choices.length) return false;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
                  draw();
                  return true;
                }
                if (event.key === "Enter") {
                  choose(choices[selected]);
                  return true;
                }
                return false;
              },
            };
          },
        }),
      ];
    },
  });
}
