import { type Editor, type Range } from "@tiptap/core";

import { linkPopup } from "../../platform/dom/popup-owner";
import {
  cardIcons,
  unavailableBlockCommands,
  matchingCommands,
  recentCommands,
  quickCommands,
  invoke,
  insertColumns,
  type CommandItem,
  type InteractiveKind,
} from "./commands";
import { insertIcons } from "./insert-icons";
import { remember } from "./recent";
import { filterInsertCommands, isInsertCommandAllowed } from "./toolbar-insert-context";

export function positionMenu(menu: HTMLElement, rect: DOMRect | null) {
  if (!rect) return;
  const view = menu.ownerDocument.defaultView;
  const margin = 8;
  const gap = 6;
  const viewport = view?.innerHeight ?? 800;
  const maxHeight = Math.max(0, Math.min(600, viewport - margin * 2));
  menu.style.maxHeight = `${maxHeight}px`;
  const height = Math.min(menu.offsetHeight || 360, maxHeight);
  const below = Math.max(0, viewport - margin - rect.bottom - gap);
  const above = Math.max(0, rect.top - gap - margin);
  const placeBelow = below >= height || below >= above;
  const available = Math.min(maxHeight, placeBelow ? below : above);
  const visibleHeight = Math.min(height, available);
  const top = placeBelow ? rect.bottom + gap : rect.top - gap - visibleHeight;
  menu.style.top = `${Math.max(margin, Math.min(top, viewport - margin - visibleHeight))}px`;
  menu.style.left = `${Math.max(margin, Math.min(rect.left, (view?.innerWidth ?? 1000) - menu.offsetWidth - margin))}px`;
  menu.style.maxHeight = `${available}px`;
}
function positionBlockMenu(menu: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect(),
    view = menu.ownerDocument.defaultView,
    margin = 8,
    gap = 6,
    width = menu.offsetWidth,
    height = menu.offsetHeight,
    viewportWidth = view?.innerWidth ?? 1000,
    viewportHeight = view?.innerHeight ?? 800;
  const right = rect.right + gap,
    left = rect.left - width - gap,
    preferred = right + width <= viewportWidth - margin || left < margin ? right : left;
  menu.style.left = `${Math.max(margin, Math.min(preferred, viewportWidth - width - margin))}px`;
  menu.style.top = `${Math.max(margin, Math.min(rect.top, viewportHeight - height - margin))}px`;
  menu.style.maxHeight = `${Math.max(0, viewportHeight - margin * 2)}px`;
}
interface PanelOptions {
  editor: Editor;
  menu: HTMLElement;
  items: CommandItem[];
  range?: Range;
  quick: boolean;
  search: boolean;
  onChoose: (item: CommandItem) => void;
  onHighlight?: (button: HTMLButtonElement) => void;
  onQuick?: (run: (editor: Editor, range?: Range) => void) => void;
  openLink?: (range?: Range) => void;
  recents?: CommandItem[];
  onRecent?: (item: CommandItem) => void;
}
export interface PanelEntry {
  item: CommandItem;
  button: HTMLButtonElement;
  recent: boolean;
}
const searchEmptyIllustration = `
  <svg class="semlo-editor-search-empty-art" viewBox="0 0 218 136" aria-hidden="true" focusable="false">
    <ellipse cx="108" cy="96" rx="81" ry="25" fill="#f8f8f0" opacity=".55" />
    <ellipse cx="110" cy="83" rx="66" ry="37" fill="#fbfaf3" opacity=".7" />
    <path d="M131 100 185 133 181 136 127 108Z" fill="#7c907d" />
    <path d="m135 104 45 29" fill="none" stroke="#adbbae" stroke-linecap="round" stroke-width="1.4" />
    <circle cx="100" cy="74" r="43" fill="#fcfcf7" stroke="#879887" stroke-width="1.5" />
    <circle cx="100" cy="74" r="39" fill="none" stroke="#d7e0d7" stroke-width="4" />
    <circle cx="100" cy="74" r="32" fill="#fefefa" stroke="#b0bcae" stroke-width="1.2" />
    <path d="M82 66c-4 7-3 15 2 21-2-7-1-14 2-21Z" fill="#e8d376" opacity=".75" />
    <path d="M72 56c8-13 19-20 33-20" fill="none" stroke="#b5c4b5" stroke-linecap="round" opacity=".7" />
    <path d="m157 31 4-5m2 11 6-3m-4 8 6-1" fill="none" stroke="#e5d27d" stroke-linecap="round" stroke-width="3" />
    <circle cx="39" cy="116" r="4" fill="none" stroke="#eadc9b" stroke-width="1.4" opacity=".75" />
    <circle cx="45" cy="113" r="1.3" fill="#eee4bd" />
  </svg>`;
export function paintPanel({
  menu,
  items,
  quick,
  search,
  onChoose,
  onHighlight,
  onQuick,
  openLink,
  recents,
  onRecent,
}: PanelOptions) {
  const doc = menu.ownerDocument;
  const enabled: PanelEntry[] = [];
  menu.replaceChildren();
  if (quick) {
    const row = doc.createElement("div");
    row.className = "semlo-editor-quick-grid";
    row.setAttribute("aria-label", "快捷格式");
    quickCommands(openLink ?? (() => {})).forEach((item) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.title = item.title;
      el.setAttribute("aria-label", item.title);
      if (item.title === "链接")
        el.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>';
      else el.textContent = item.glyph;
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => onQuick?.(item.run));
      row.append(el);
    });
    menu.append(row);
  }
  if (recents?.length) {
    const section = doc.createElement("div");
    section.className = "semlo-editor-recent-section";
    const heading = doc.createElement("div");
    heading.className = "semlo-editor-recent-heading";
    heading.textContent = "最近使用";
    section.append(heading);
    const list = doc.createElement("div");
    list.className = "semlo-editor-recent-list";
    list.setAttribute("aria-label", "最近使用");
    for (const item of recents) {
      const tag = doc.createElement("button");
      tag.type = "button";
      tag.className = "semlo-editor-recent-item";
      tag.textContent = item.id === "paragraph" ? "文本" : item.title;
      tag.dataset.command = item.id;
      enabled.push({ item, button: tag, recent: true });
      tag.addEventListener("mousedown", (event) => event.preventDefault());
      tag.addEventListener("mouseenter", () => onHighlight?.(tag));
      tag.addEventListener("click", () => onRecent?.(item));
      list.append(tag);
    }
    section.append(list);
    menu.append(section);
  }
  if (!items.length) {
    const empty = doc.createElement("div");
    empty.className = "semlo-editor-slash-empty";
    if (search) {
      empty.classList.add("semlo-editor-search-empty");
      empty.innerHTML = `${searchEmptyIllustration}<span>暂无匹配的搜索结果</span>`;
    } else empty.textContent = "没有找到匹配的内容";
    menu.append(empty);
    return enabled;
  }
  const order = [
    "image",
    "table",
    "attachment",
    "status",
    "ai",
    "canvas",
    "mindmap",
    "flowchart",
    "database",
    "album",
    "kanban",
    "code",
    "math",
    "blockMath",
    "uml",
    "diagram",
    "callout",
    "details",
    "columns",
    "columns2",
    "columns3",
    "columns4",
    "quote",
    "divider",
    "emoji",
    "gallery",
    "mention",
    "yuque",
    "calendar",
    "date",
    "vote",
    "checkin",
    "encrypted",
    "localFile",
    "audio",
    "video",
    "youku",
    "bilibili",
    "netease",
    "taobao",
    "amap",
    "modao",
    "figma",
    "processon",
    "canva",
    "juejin",
    "codepen",
    "yida",
    "jinshuju",
  ];
  const groups: ReadonlyArray<readonly [CommandItem["group"], string]> = [
    ["basic", "基础"],
    ["smart", "智能专区"],
    ["canvas", "画板类"],
    ["data", "数据表"],
    ["developer", "程序员专区"],
    ["layout", "布局和样式"],
    ["tools", "小工具"],
    ["local", "嵌入本地文件"],
    ["external", "嵌入第三方服务"],
  ];
  const sections = groups.map(([group, label]) => ({
    group,
    label,
    items: items
      .filter((item) => item.group === group)
      .sort((a, b) => {
        const left = order.indexOf(a.id),
          right = order.indexOf(b.id);
        return left < 0 || right < 0 ? 0 : left - right;
      }),
  }));
  const visibleSections = search
    ? [{ group: null, label: "搜索结果", items: sections.flatMap((section) => section.items) }]
    : sections.filter((section) => section.items.length);
  for (const { group, label, items: matching } of visibleSections) {
    const labelEl = doc.createElement("div");
    labelEl.className = "semlo-editor-card-section";
    labelEl.textContent = label;
    menu.append(labelEl);
    const wrap = doc.createElement("div");
    wrap.className = group === "basic" ? "semlo-editor-card-basic" : "semlo-editor-card-group";
    wrap.addEventListener(
      "pointerdown",
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest("button:disabled")) event.preventDefault();
      },
      true,
    );
    menu.append(wrap);
    matching.forEach((item) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = "semlo-editor-card-item";
      el.dataset.command = item.id;
      el.setAttribute("role", "option");
      el.setAttribute("aria-label", `${item.title} ${item.description}`);
      el.setAttribute("aria-selected", "false");
      el.disabled = !!item.disabled;
      if (item.disabled) el.title = "暂不可用";
      else enabled.push({ item, button: el, recent: false });
      const badge = doc.createElement("span");
      badge.className = "semlo-editor-card-icon";
      badge.setAttribute("aria-hidden", "true");
      badge.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${cardIcons[item.id] ?? insertIcons[item.id] ?? (item.id.startsWith("columns") ? cardIcons.columns : item.id === "blockMath" ? cardIcons.math : cardIcons.unavailable)}</svg>`;
      const text = doc.createElement("span");
      text.className = "semlo-editor-card-copy";
      const name = doc.createElement("span");
      name.className = "semlo-editor-card-name";
      name.textContent = item.title;
      text.append(name);
      if (item.group !== "basic") {
        const desc = doc.createElement("span");
        desc.className = "semlo-editor-card-desc";
        desc.textContent = item.description;
        text.append(desc);
      }
      el.append(badge, text);
      if (item.shortcut) {
        const shortcut = doc.createElement("span");
        shortcut.className = "semlo-editor-card-shortcut";
        shortcut.textContent = item.shortcut;
        el.append(shortcut);
      }
      if (item.id === "table" || item.id === "columns") {
        const arrow = doc.createElement("span");
        arrow.className = "semlo-editor-card-arrow";
        arrow.textContent = "›";
        el.append(arrow);
      }
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("mouseenter", () => {
        if (!item.disabled) onHighlight?.(el);
      });
      el.addEventListener("click", () => onChoose(item));
      wrap.append(el);
    });
  }
  return enabled;
}
export function highlightCommand(enabled: PanelEntry[], selected: number, scroll = false) {
  enabled.forEach((entry, index) => {
    const isActive = index === selected;
    entry.button.classList.toggle("selected", isActive);
    entry.button.setAttribute(entry.recent ? "aria-current" : "aria-selected", String(isActive));
  });
  if (scroll) enabled[selected]?.button.scrollIntoView({ block: "nearest" });
}
export function nextCommand(enabled: PanelEntry[], selected: number, direction: "up" | "down" | "left" | "right") {
  if (!enabled.length) return -1;
  if (selected < 0) return direction === "up" ? enabled.length - 1 : 0;
  const active = enabled[selected].button.getBoundingClientRect();
  const centerX = active.left + active.width / 2;
  const centerY = active.top + active.height / 2;
  const vertical = direction === "up" || direction === "down";
  const positive = direction === "down" || direction === "right";
  let best = selected;
  let bestPrimary = Infinity;
  let bestSecondary = Infinity;
  enabled.forEach((entry, index) => {
    if (index === selected) return;
    const rect = entry.button.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - centerX;
    const dy = rect.top + rect.height / 2 - centerY;
    const primary = vertical ? dy : dx;
    const secondary = vertical ? dx : dy;
    if (
      (positive ? primary <= 2 : primary >= -2) ||
      (!vertical && Math.abs(dy) > Math.min(active.height, rect.height) / 2)
    )
      return;
    if (
      Math.abs(primary) < bestPrimary - 2 ||
      (Math.abs(Math.abs(primary) - bestPrimary) <= 2 && Math.abs(secondary) < bestSecondary)
    ) {
      best = index;
      bestPrimary = Math.abs(primary);
      bestSecondary = Math.abs(secondary);
    }
  });
  return best;
}
/** Keep the table/column submenu beside its row as the editor or menu scrolls. */
function followSidePanel(anchor: HTMLElement, panel: HTMLElement, onHidden: () => void) {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView;
  const viewport = view?.visualViewport;
  let stopped = false;
  const update = () => {
    if (stopped || !view) return;
    if (!anchor.isConnected || !panel.isConnected) {
      onHidden();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (
        (/^(auto|scroll|hidden|clip)$/.test(style.overflowY) && (rect.bottom <= clip.top || rect.top >= clip.bottom)) ||
        (/^(auto|scroll|hidden|clip)$/.test(style.overflowX) && (rect.right <= clip.left || rect.left >= clip.right))
      ) {
        onHidden();
        return;
      }
    }
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? view.innerWidth);
    const bottom = top + (viewport?.height ?? view.innerHeight);
    const margin = 8;
    const gap = 6;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const preferred =
      rect.right + gap + width <= right - margin || rect.left - gap - width < left + margin
        ? rect.right + gap
        : rect.left - gap - width;
    panel.style.left = `${Math.max(left + margin, Math.min(preferred, right - margin - width))}px`;
    panel.style.top = `${Math.max(top + margin, Math.min(rect.top, bottom - margin - height))}px`;
  };
  const scroll = (event: Event) => {
    if (!panel.contains(event.target as Node)) update();
  };
  doc.addEventListener("scroll", scroll, true);
  view?.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  return {
    update,
    stop: () => {
      if (stopped) return;
      stopped = true;
      doc.removeEventListener("scroll", scroll, true);
      view?.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    },
  };
}

function retainSidePanelFocus(root: HTMLElement, panel: HTMLElement | undefined) {
  if (!root.isConnected || !panel?.contains(root.ownerDocument.activeElement)) return;
  if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
  root.focus({ preventScroll: true });
}

function retainOtherSidePanelFocus(root: HTMLElement, selector: string) {
  const panel = root.ownerDocument.activeElement?.closest<HTMLElement>(selector);
  if (
    panel?.id &&
    Array.from(root.querySelectorAll("[aria-controls]")).some((anchor) =>
      anchor.getAttribute("aria-controls")?.split(/\s+/).includes(panel.id),
    )
  )
    retainSidePanelFocus(root, panel);
}

export function addTableGrid(
  root: HTMLElement,
  editor: Editor,
  range: Range | undefined,
  close: () => void,
  hideOther: () => void,
  prepare?: () => boolean,
) {
  const tableButton = root.querySelector<HTMLButtonElement>('.semlo-editor-card-item[data-command="table"]');
  if (!tableButton) return;
  let grid: HTMLElement | undefined;
  let unlinkGrid: (() => void) | undefined;
  let stopPosition: (() => void) | undefined;
  const previousExpanded = tableButton.getAttribute("aria-expanded");
  let timer: number | undefined;
  const cancel = () => {
    if (timer !== undefined) root.ownerDocument.defaultView?.clearTimeout(timer);
    timer = undefined;
  };
  const hide = (retainFocus = false) => {
    cancel();
    stopPosition?.();
    stopPosition = undefined;
    const previous = grid;
    if (retainFocus) retainSidePanelFocus(root, previous);
    const unlink = unlinkGrid;
    grid = undefined;
    unlinkGrid = undefined;
    if (previous) {
      if (previousExpanded === null) tableButton.removeAttribute("aria-expanded");
      else tableButton.setAttribute("aria-expanded", previousExpanded);
    }
    previous?.remove();
    unlink?.();
  };
  const schedule = () => {
    cancel();
    timer = root.ownerDocument.defaultView?.setTimeout(() => {
      timer = undefined;
      if (!grid?.contains(root.ownerDocument.activeElement)) hide();
    }, 180);
  };
  const show = () => {
    if (!root.isConnected) return;
    cancel();
    retainOtherSidePanelFocus(root, ".semlo-editor-column-picker");
    hideOther();
    if (!root.isConnected) return;
    if (grid) return;
    const doc = root.ownerDocument;
    grid = doc.createElement("div");
    grid.className = "semlo-editor-table-grid-popover";
    unlinkGrid = linkPopup(tableButton, grid);
    tableButton.setAttribute("aria-expanded", "true");
    if (root.closest(".semlo-editor-card-menu-block")) grid.classList.add("semlo-editor-block-insert-popover");
    grid.setAttribute("aria-label", "选择表格大小");
    const label = doc.createElement("div");
    label.textContent = "表格";
    label.className = "semlo-editor-card-section";
    grid.append(label);
    const cells = doc.createElement("div");
    cells.className = "semlo-editor-table-grid";
    grid.append(cells);
    const value = doc.createElement("div");
    value.className = "semlo-editor-table-grid-value";
    value.textContent = "0 × 0";
    grid.append(value);
    const highlight = (row: number, col: number) => {
      value.textContent = `${row} × ${col}`;
      cells
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => b.classList.toggle("selected", Number(b.dataset.row) <= row && Number(b.dataset.col) <= col));
    };
    for (let row = 1; row <= 6; row++)
      for (let col = 1; col <= 6; col++) {
        const cell = doc.createElement("button");
        cell.type = "button";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.setAttribute("aria-label", `${row}行${col}列`);
        cell.addEventListener("mouseenter", () => highlight(row, col));
        cell.addEventListener("focus", () => highlight(row, col));
        cell.addEventListener("mousedown", (e) => e.preventDefault());
        cell.addEventListener("click", () => {
          if (prepare && !prepare()) {
            close();
            return;
          }
          close();
          remember(editor, "table");
          const chain = editor.chain().focus();
          if (range) chain.deleteRange(range);
          chain.insertTable({ rows: row, cols: col, withHeaderRow: false }).run();
        });
        cells.append(cell);
      }
    grid.addEventListener("mouseenter", cancel);
    grid.addEventListener("mouseleave", schedule);
    grid.addEventListener("focusout", (event) => {
      if (
        grid &&
        (!event.relatedTarget || !("nodeType" in event.relatedTarget) || !grid.contains(event.relatedTarget as Node)) &&
        !tableButton.matches(":hover") &&
        !grid.matches(":hover")
      )
        schedule();
    });
    doc.body.append(grid);
    const position = followSidePanel(tableButton, grid, () => hide(true));
    stopPosition = position.stop;
    position.update();
  };
  tableButton.addEventListener("mouseenter", show);
  tableButton.addEventListener("mouseleave", schedule);
  tableButton.addEventListener("focus", show);
  if (root.classList.contains("semlo-editor-slash-menu")) tableButton.addEventListener("click", show);
  return hide;
}
export function addColumnPicker(
  root: HTMLElement,
  editor: Editor,
  range: Range | undefined,
  close: () => void,
  hideOther: () => void,
  prepare?: () => boolean,
) {
  const button = root.querySelector<HTMLButtonElement>('.semlo-editor-card-item[data-command="columns"]');
  if (!button) return;
  let panel: HTMLElement | undefined;
  let unlinkPanel: (() => void) | undefined;
  let stopPosition: (() => void) | undefined;
  const previousExpanded = button.getAttribute("aria-expanded");
  let timer: number | undefined;
  const cancel = () => {
    if (timer !== undefined) root.ownerDocument.defaultView?.clearTimeout(timer);
    timer = undefined;
  };
  const hide = (retainFocus = false) => {
    cancel();
    stopPosition?.();
    stopPosition = undefined;
    const previous = panel;
    if (retainFocus) retainSidePanelFocus(root, previous);
    const unlink = unlinkPanel;
    panel = undefined;
    unlinkPanel = undefined;
    if (previous) {
      if (previousExpanded === null) button.removeAttribute("aria-expanded");
      else button.setAttribute("aria-expanded", previousExpanded);
    }
    previous?.remove();
    unlink?.();
  };
  const schedule = () => {
    cancel();
    timer = root.ownerDocument.defaultView?.setTimeout(() => {
      timer = undefined;
      if (!panel?.contains(root.ownerDocument.activeElement)) hide();
    }, 180);
  };
  const show = () => {
    if (!root.isConnected) return;
    cancel();
    retainOtherSidePanelFocus(root, ".semlo-editor-table-grid-popover");
    hideOther();
    if (!root.isConnected) return;
    if (panel) return;
    const doc = root.ownerDocument;
    panel = doc.createElement("div");
    panel.className = "semlo-editor-column-picker";
    unlinkPanel = linkPopup(button, panel);
    button.setAttribute("aria-expanded", "true");
    if (root.closest(".semlo-editor-card-menu-block")) panel.classList.add("semlo-editor-block-insert-popover");
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "选择分栏数");
    for (const [count, label] of [
      [2, "两栏"],
      [3, "三栏"],
      [4, "四栏"],
    ] as const) {
      const option = doc.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitem");
      option.setAttribute("aria-label", label);
      option.innerHTML = `<span aria-hidden="true">▥</span><span>${label}</span><span class="semlo-editor-column-shortcut">/fl${count}</span>`;
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        if (prepare && !prepare()) {
          close();
          return;
        }
        close();
        remember(editor, "columns");
        insertColumns(count)(editor, range);
      });
      panel.append(option);
    }
    panel.addEventListener("mouseenter", cancel);
    panel.addEventListener("mouseleave", schedule);
    panel.addEventListener("focusout", (event) => {
      if (
        panel &&
        (!event.relatedTarget ||
          !("nodeType" in event.relatedTarget) ||
          !panel.contains(event.relatedTarget as Node)) &&
        !button.matches(":hover") &&
        !panel.matches(":hover")
      )
        schedule();
    });
    doc.body.append(panel);
    const position = followSidePanel(button, panel, () => hide(true));
    stopPosition = position.stop;
    position.update();
  };
  button.addEventListener("mouseenter", show);
  button.addEventListener("mouseleave", schedule);
  button.addEventListener("focus", show);
  return hide;
}

/** Toolbar and shortcut panel; search never replaces the document selection. */
export function openCardMenu(
  editor: Editor,
  openImage: () => void,
  openAttachment: () => void,
  openEmoji: () => void,
  openMedia: (kind: "video" | "audio") => void,
  openLink: (range?: Range) => void,
  anchorElement?: HTMLElement,
  options?: {
    beforeChoose?: (id: string) => boolean;
    onClose?: () => void;
    onChoose?: () => void;
    onOpen?: (panel: HTMLElement) => void;
    onEscape?: () => void;
    trigger?: HTMLElement;
    focusPanel?: boolean;
    focusSearch?: boolean;
    blockBelow?: boolean;
    getInsertPosition?: () => number | null;
    onWriting?: (range?: Range) => void;
    onInteractive?: (kind: InteractiveKind) => void;
    interactiveAvailable?: (kind: InteractiveKind) => boolean;
  },
): () => void {
  const doc = editor.view.dom.ownerDocument;
  const root = doc.createElement("div");
  const blockBelow = options?.blockBelow ?? false;
  root.className = `semlo-editor-card-menu${blockBelow ? " semlo-editor-card-menu-block" : ""}`;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "插入内容");
  if (blockBelow) root.tabIndex = -1;
  const trigger = options?.trigger ?? (anchorElement?.matches('button,[role="button"]') ? anchorElement : undefined);
  const unlinkRoot = trigger ? linkPopup(trigger, root) : undefined;
  trigger?.setAttribute("aria-expanded", "true");
  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "请输入要搜索的功能名称";
  input.setAttribute("aria-label", "搜索插入内容");
  const list = doc.createElement("div");
  list.className = "semlo-editor-card-list";
  list.setAttribute("role", "listbox");
  if (!blockBelow) root.append(input);
  root.append(list);
  doc.body.append(root);
  const insertPosition = () => (options?.getInsertPosition ? options.getInsertPosition() : editor.state.selection.from);
  const panelItems = (query = "") => {
    const normalized = query.trim().toLowerCase();
    const unavailable = unavailableBlockCommands(editor, options?.onWriting).filter(
      (item) => !normalized || item.key.toLowerCase().includes(normalized),
    );
    const available = matchingCommands(
      openImage,
      openAttachment,
      openEmoji,
      openMedia,
      query,
      options?.onInteractive,
      options?.interactiveAvailable,
    );
    const position = insertPosition();
    if (position === null) return [];
    return filterInsertCommands(
      editor.state,
      [...(blockBelow ? available.filter((item) => item.id !== "blockMath") : available), ...unavailable],
      position,
    );
  };
  let items = panelItems();
  let enabled: PanelEntry[] = [];
  let selected = -1;
  let closed = false;
  let removeGrid: (() => void) | undefined;
  let removeColumns: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    editor.off("unmount", close);
    removeGrid?.();
    removeColumns?.();
    unlinkRoot?.();
    trigger?.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", keyboard, true);
    doc.removeEventListener("scroll", onScroll, true);
    doc.defaultView?.removeEventListener("resize", reposition);
    doc.defaultView?.visualViewport?.removeEventListener("resize", reposition);
    doc.defaultView?.visualViewport?.removeEventListener("scroll", reposition);
    root.remove();
    options?.onClose?.();
  };
  const closeSelected = () => {
    close();
    options?.onChoose?.();
  };
  const prepare = (id: string) => {
    if (closed) return false;
    const position = insertPosition();
    return (
      position !== null && isInsertCommandAllowed(editor.state, id, position) && (options?.beforeChoose?.(id) ?? true)
    );
  };
  const choose = (item: CommandItem) => {
    if (item.disabled) return;
    if (!prepare(item.id)) {
      close();
      return;
    }
    closeSelected();
    invoke(item, editor);
  };
  const chooseRecent = (item: CommandItem) => {
    if (!prepare(item.id)) {
      close();
      return;
    }
    closeSelected();
    invoke(item, editor);
  };
  const draw = () => {
    removeGrid?.();
    removeColumns?.();
    root.classList.toggle("semlo-editor-card-menu-empty", Boolean(input.value.trim()) && !items.length);
    enabled = paintPanel({
      editor,
      menu: list,
      items,
      quick: false,
      search: Boolean(input.value.trim()),
      onChoose: choose,
      onHighlight: (button) => {
        const index = enabled.findIndex((candidate) => candidate.button === button);
        if (index < 0) return;
        selected = index;
        highlightCommand(enabled, selected);
      },
      recents:
        blockBelow || input.value.trim()
          ? []
          : recentCommands(
              editor,
              openImage,
              openAttachment,
              openEmoji,
              openMedia,
              openLink,
              options?.onInteractive,
              options?.interactiveAvailable,
            ),
      onRecent: chooseRecent,
    });
    selected = Math.min(selected, enabled.length - 1);
    highlightCommand(enabled, selected);
    removeGrid = addTableGrid(
      list,
      editor,
      undefined,
      closeSelected,
      () => removeColumns?.(),
      () => prepare("table"),
    );
    removeColumns = addColumnPicker(
      list,
      editor,
      undefined,
      closeSelected,
      () => removeGrid?.(),
      () => prepare("columns"),
    );
    reposition();
  };
  const reposition = () => {
    if (anchorElement && !anchorElement.isConnected) {
      close();
      return;
    }
    if (blockBelow && anchorElement) {
      positionBlockMenu(root, anchorElement);
      return;
    }
    const coords = anchorElement?.getBoundingClientRect() ?? editor.view.coordsAtPos(editor.state.selection.from);
    positionMenu(root, new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top));
  };
  // Scrolling the menu itself must not move the panel; document and nested
  // container scrolling can move its trigger, especially as the toolbar sticks.
  const onScroll = (event: Event) => {
    if (!root.contains(event.target as Node)) reposition();
  };
  const outside = (event: Event) => {
    const target = event.target as Node;
    if (
      !root.contains(target) &&
      !anchorElement?.contains(target) &&
      !(
        target.nodeType === 1 &&
        (target as Element).closest(".semlo-editor-table-grid-popover,.semlo-editor-column-picker")
      )
    )
      close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || editor.view.composing) return;
    if (event.key === "Escape") {
      const activePopup = doc.activeElement?.closest<HTMLElement>(
        ".semlo-editor-table-grid-popover,.semlo-editor-column-picker",
      );
      const ownedPopup =
        activePopup?.id &&
        Array.from(root.querySelectorAll("[aria-controls]")).some((anchor) =>
          anchor.getAttribute("aria-controls")?.split(/\s+/).includes(activePopup.id),
        );
      if (
        !root.contains(doc.activeElement) &&
        !trigger?.contains(doc.activeElement) &&
        !ownedPopup &&
        !(blockBelow && editor.view.dom.contains(doc.activeElement))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close();
      if (blockBelow) options?.onEscape?.();
      else if (!editor.isDestroyed && editor.isEditable) editor.view.focus();
    }
  };
  input.addEventListener("input", () => {
    items = panelItems(input.value);
    selected = input.value.trim() ? 0 : -1;
    draw();
  });
  const navigate = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || editor.view.composing) return;
    if (!enabled.length) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selected >= 0)
    ) {
      event.preventDefault();
      const direction = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" }[event.key] as
        | "up"
        | "down"
        | "left"
        | "right";
      selected = nextCommand(enabled, selected, direction);
      highlightCommand(enabled, selected, true);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selected < 0) return;
      const entry = enabled[selected];
      const item = entry.item;
      if (entry.recent) {
        chooseRecent(item);
        return;
      }
      if (item.id === "table") {
        if (!prepare(item.id)) {
          close();
          return;
        }
        closeSelected();
        invoke(item, editor);
      } else choose(item);
    }
  };
  const navigationTarget = blockBelow ? root : input;
  navigationTarget.addEventListener("keydown", navigate);
  editor.on("unmount", close);
  draw();
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", keyboard, true);
  doc.addEventListener("scroll", onScroll, true);
  doc.defaultView?.addEventListener("resize", reposition);
  doc.defaultView?.visualViewport?.addEventListener("resize", reposition);
  doc.defaultView?.visualViewport?.addEventListener("scroll", reposition);
  if (blockBelow) {
    options?.onOpen?.(root);
    if (options?.focusPanel !== false) root.focus({ preventScroll: true });
  } else if (options?.focusSearch !== false) input.focus();
  return close;
}
