import type { Editor } from "@tiptap/core";

import { linkPopup } from "../../platform/dom/popup-owner";

type EmojiEntry = {
  unicode: string;
  label: string;
  group?: number;
  tags?: string[];
  skins?: Array<{ unicode: string; hexcode: string }>;
};
const groups: Array<[number, string]> = [
  [0, "表情"],
  [1, "人物"],
  [3, "自然"],
  [4, "食物"],
  [5, "旅行"],
  [6, "活动"],
  [7, "物品"],
  [8, "符号"],
  [9, "旗帜"],
];
const skinCodes = ["", "1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
let emojiData: Promise<EmojiEntry[]> | undefined;
function loadEmoji(): Promise<EmojiEntry[]> {
  return (emojiData ??= import("emojibase-data/zh/compact.json")
    .then((module) => module.default as EmojiEntry[])
    .catch((error) => {
      emojiData = undefined;
      throw error;
    }));
}

/** The picker uses bundled Unicode data and never fetches a remote emoji service. */
export function openEmojiPicker(editor: Editor, anchor?: HTMLElement): () => void {
  const doc = editor.view.dom.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-emoji-picker";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "选择表情");
  const unlinkPopup = anchor ? linkPopup(anchor, panel) : undefined;
  anchor?.setAttribute("aria-expanded", "true");
  const input = doc.createElement("input");
  input.type = "search";
  input.placeholder = "请输入关键字";
  input.setAttribute("aria-label", "搜索表情");
  const skin = doc.createElement("select");
  skin.setAttribute("aria-label", "表情肤色");
  for (const label of ["默认肤色", "较浅肤色", "中等偏浅肤色", "中等肤色", "中等偏深肤色", "较深肤色"]) {
    const option = doc.createElement("option");
    option.value = String(skin.options.length);
    option.textContent = label;
    skin.append(option);
  }
  const search = doc.createElement("div");
  search.className = "semlo-editor-emoji-search";
  search.append(input, skin);
  const content = doc.createElement("div");
  content.className = "semlo-editor-emoji-content";
  const tabs = doc.createElement("div");
  tabs.className = "semlo-editor-emoji-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "表情分类");
  panel.append(search, content, tabs);
  doc.body.append(panel);
  const rect = editor.view.coordsAtPos(editor.state.selection.from);
  const width = Math.min(420, (doc.defaultView?.innerWidth ?? 1000) - 16);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(8, Math.min(rect.left, (doc.defaultView?.innerWidth ?? 1000) - width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(rect.bottom + 8, (doc.defaultView?.innerHeight ?? 800) - 365))}px`;
  let entries: EmojiEntry[] = [];
  let group = 0;
  let closed = false;
  let loading = true;
  const drawTabs = () => {
    tabs.replaceChildren();
    for (const [id, label] of groups) {
      const tab = doc.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(id === group));
      tab.textContent = label;
      tab.addEventListener("click", () => {
        group = id;
        input.value = "";
        draw();
        input.focus();
      });
      tabs.append(tab);
    }
  };
  const draw = () => {
    if (closed) return;
    drawTabs();
    content.replaceChildren();
    const heading = doc.createElement("div");
    heading.className = "semlo-editor-emoji-heading";
    heading.textContent = loading
      ? "正在加载表情…"
      : input.value.trim()
        ? "搜索结果"
        : (groups.find(([id]) => id === group)?.[1] ?? "表情");
    content.append(heading);
    if (loading) return;
    const query = input.value.trim().toLowerCase();
    const matching = entries.filter(
      (entry) =>
        typeof entry.group === "number" &&
        (query
          ? `${entry.label} ${entry.unicode} ${(entry.tags ?? []).join(" ")}`.toLowerCase().includes(query)
          : entry.group === group),
    );
    if (!matching.length) {
      const empty = doc.createElement("div");
      empty.className = "semlo-editor-emoji-empty";
      empty.textContent = "没有找到表情";
      content.append(empty);
      return;
    }
    const grid = doc.createElement("div");
    grid.className = "semlo-editor-emoji-grid";
    for (const entry of matching) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "semlo-editor-emoji-item";
      const code = skinCodes[Number(skin.value)];
      const chosen = code
        ? (entry.skins?.find((variant) => variant.hexcode.endsWith(code))?.unicode ?? entry.unicode)
        : entry.unicode;
      item.textContent = chosen;
      item.setAttribute("aria-label", entry.label);
      item.title = entry.label;
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        if (editor.isDestroyed || !editor.isEditable) return;
        editor.chain().focus().insertContent(chosen).run();
        input.focus();
      });
      grid.append(item);
    }
    content.append(grid);
    content.scrollTop = 0;
  };
  const outside = (event: Event) => {
    if (!panel.contains(event.target as globalThis.Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      const target = event.target as globalThis.Node | null;
      const owner = editor.view.dom.closest(".semlo-editor");
      if (!target || (!panel.contains(target) && !anchor?.contains(target) && !owner?.contains(target))) return;
      event.preventDefault();
      close();
      if (!editor.isDestroyed) editor.commands.focus();
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    unlinkPopup?.();
    anchor?.setAttribute("aria-expanded", "false");
    panel.remove();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", key, true);
  };
  input.addEventListener("input", draw);
  skin.addEventListener("change", draw);
  draw();
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", key, true);
  input.focus();
  void loadEmoji()
    .then((data) => {
      if (closed) return;
      entries = data;
      loading = false;
      draw();
    })
    .catch(() => {
      if (closed) return;
      loading = false;
      content.textContent = "表情数据加载失败";
    });
  return close;
}
