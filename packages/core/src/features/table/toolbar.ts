import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { DOMSerializer, type DOMOutputSpec, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { TableMap, selectedRect } from "@tiptap/pm/tables";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { runCleanupSteps } from "../../runtime/cleanup";

const defaultBackground = "#FAFAFA";
const defaultForeground = "#262626";
const schemes = [
  ["默认", "#FAFAFA", "#262626"],
  ["浅绿", "#E8F7CF", "#2A4200"],
  ["浅蓝", "#D9EAFC", "#00346B"],
  ["浅红", "#FBE4E7", "#70000D"],
  ["深绿", "#406105", "#E8F7CF"],
  ["深蓝", "#074A92", "#D9EAFC"],
] as const;

function color(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

function widths(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 500) return null;
  if (!value.every((item) => typeof item === "number" && Number.isFinite(item) && item > 0 && item <= 100000))
    return null;
  return value.slice();
}

function parseWidths(value: string | null): number[] | null {
  if (!value || value.length > 10000) return null;
  try {
    return widths(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Table-level attributes keep the header appearance and fit mode in JSON and HTML. */
export function tableStyleAttributes() {
  return {
    semloEditorHeaderRow: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-table-header-row") === "true",
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.semloEditorHeaderRow === true ? { "data-semlo-editor-table-header-row": "true" } : {},
    },
    semloEditorHeaderColumn: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-table-header-column") === "true",
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.semloEditorHeaderColumn === true ? { "data-semlo-editor-table-header-column": "true" } : {},
    },
    semloEditorHeaderBackground: {
      default: null,
      parseHTML: (element: HTMLElement) => color(element.getAttribute("data-semlo-editor-table-header-background")),
      renderHTML: (attrs: Record<string, unknown>) => {
        const value = color(attrs.semloEditorHeaderBackground);
        return value
          ? { "data-semlo-editor-table-header-background": value, style: `--semlo-editor-table-head-bg: ${value}` }
          : {};
      },
    },
    semloEditorHeaderColor: {
      default: null,
      parseHTML: (element: HTMLElement) => color(element.getAttribute("data-semlo-editor-table-header-color")),
      renderHTML: (attrs: Record<string, unknown>) => {
        const value = color(attrs.semloEditorHeaderColor);
        return value
          ? { "data-semlo-editor-table-header-color": value, style: `--semlo-editor-table-head-color: ${value}` }
          : {};
      },
    },
    semloEditorBorderHidden: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-table-border-hidden") === "true",
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.semloEditorBorderHidden === true ? { "data-semlo-editor-table-border-hidden": "true" } : {},
    },
    semloEditorFitWidth: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-table-fit") === "true",
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs.semloEditorFitWidth === true ? { "data-semlo-editor-table-fit": "true" } : {},
    },
    semloEditorFitWidths: {
      default: null,
      parseHTML: (element: HTMLElement) => parseWidths(element.getAttribute("data-semlo-editor-table-fit-widths")),
      renderHTML: (attrs: Record<string, unknown>) => {
        const value = widths(attrs.semloEditorFitWidths);
        return value ? { "data-semlo-editor-table-fit-widths": JSON.stringify(value) } : {};
      },
    },
  };
}

function columnWidths(node: ProseMirrorNode, fallback: number): number[] {
  const result: number[] = [];
  node.firstChild?.forEach((cell) => {
    const span = Math.max(1, Number(cell.attrs.colspan) || 1);
    for (let index = 0; index < span; index++) {
      const item = Number(cell.attrs.colwidth?.[index]);
      result.push(Number.isFinite(item) && item > 0 ? item : fallback);
    }
  });
  return result;
}

function fitPercentages(node: ProseMirrorNode, count: number): number[] {
  const stored = widths(node.attrs.semloEditorFitWidths);
  const current = columnWidths(node, 60);
  const values = stored?.length === count ? stored : current.length === count ? current : Array(count).fill(1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => (value / total) * 100);
}

/** Keep live NodeView colgroups responsive while the stored widths stay intact. */
export function syncFittedTable(node: ProseMirrorNode, table: HTMLTableElement, colgroup: HTMLTableColElement) {
  if (node.attrs.semloEditorFitWidth !== true) return;
  const cols = Array.from(colgroup.children) as HTMLElement[];
  const percentages = fitPercentages(node, cols.length);
  table.style.width = "100%";
  table.style.minWidth = "0";
  cols.forEach((col, index) => {
    col.style.width = `${percentages[index]}%`;
    col.style.minWidth = "0";
  });
}

/** Preserve column sizing when custom header CSS variables are also serialized. */
export function tableStyleOutput(output: DOMOutputSpec, node: ProseMirrorNode, cellMinWidth: number): DOMOutputSpec {
  if (!Array.isArray(output)) return output;
  const table = output[0] === "table" ? output : output[0] === "div" ? output[2] : undefined;
  if (!Array.isArray(table) || table[0] !== "table" || typeof table[1] !== "object" || !table[1]) return output;
  const attrs = table[1] as Record<string, unknown>;
  const values = columnWidths(node, cellMinWidth);
  const firstRow = node.firstChild;
  const allFixed =
    Boolean(firstRow) &&
    (() => {
      let fixed = true;
      firstRow?.forEach((cell) => {
        const span = Math.max(1, Number(cell.attrs.colspan) || 1);
        for (let index = 0; index < span; index++) if (!(Number(cell.attrs.colwidth?.[index]) > 0)) fixed = false;
      });
      return fixed;
    })();
  const total = values.reduce((sum, value) => sum + value, 0);
  const size =
    node.attrs.semloEditorFitWidth === true
      ? "width: 100%; min-width: 0"
      : allFixed
        ? `width: ${total}px`
        : `min-width: ${total}px`;
  attrs.style = `${typeof attrs.style === "string" ? attrs.style : ""}; ${size}`;
  if (node.attrs.semloEditorFitWidth === true) {
    const group = table.find((item) => Array.isArray(item) && item[0] === "colgroup");
    if (Array.isArray(group)) {
      const cols = group.slice(2).filter((item) => Array.isArray(item)) as Array<unknown[]>;
      const percentages = fitPercentages(node, cols.length);
      cols.forEach((col, index) => {
        col[1] = { ...(typeof col[1] === "object" && col[1] ? col[1] : {}), style: `width: ${percentages[index]}%` };
      });
    }
  }
  if (node.attrs.semloEditorHeaderColumn === true) serializeHeaderColumn(table, node);
  return output;
}

/** Mark logical first-column cells in exported HTML, including cells under rowspans. */
function serializeHeaderColumn(table: unknown[], node: ProseMirrorNode) {
  const bodyIndex = table.findIndex((item) => Array.isArray(item) && item[0] === "tbody");
  if (bodyIndex < 0) return;
  const map = TableMap.get(node);
  if (!map.width) return;
  const firstColumn = new Set<number>();
  for (let row = 0; row < map.height; row++) firstColumn.add(map.map[row * map.width]);
  const serializer = DOMSerializer.fromSchema(node.type.schema);
  const rows: globalThis.Node[] = [];
  let valid = true;
  node.forEach((row, rowOffset) => {
    const element = serializer.serializeNode(row);
    if (element.nodeType !== 1 || element.nodeName !== "TR") {
      valid = false;
      return;
    }
    const cells = Array.from((element as Element).children).filter((cell) => cell.matches("td,th"));
    if (cells.length !== row.childCount) {
      valid = false;
      return;
    }
    let index = 0;
    row.forEach((_cell, cellOffset) => {
      if (firstColumn.has(rowOffset + 1 + cellOffset))
        cells[index].setAttribute("data-semlo-editor-header-cell", "true");
      index++;
    });
    rows.push(element);
  });
  if (!valid) return;
  (table[1] as Record<string, unknown>)["data-semlo-editor-table-header-cells"] = "true";
  table[bodyIndex] = ["tbody", ...rows];
}

/** Decorations identify logical first-column cells even when rowspans are present. */
const tableHeaderKey = new PluginKey<DecorationSet>("semloEditorTableHeaders");
export function tableHeaderDecorations() {
  return new Plugin({
    key: tableHeaderKey,
    state: {
      init: (_, state) => headerDecorations(state.doc),
      apply: (transaction, previous) => (transaction.docChanged ? headerDecorations(transaction.doc) : previous),
    },
    props: { decorations: (state) => tableHeaderKey.getState(state) },
  });
}

function headerDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.spec.tableRole !== "table") return true;
    if (node.attrs.semloEditorHeaderRow !== true && node.attrs.semloEditorHeaderColumn !== true) return true;
    const map = TableMap.get(node);
    const cells = new Set<number>();
    if (node.attrs.semloEditorHeaderRow === true)
      for (let column = 0; column < map.width; column++) cells.add(map.map[column]);
    if (node.attrs.semloEditorHeaderColumn === true)
      for (let row = 0; row < map.height; row++) cells.add(map.map[row * map.width]);
    for (const offset of cells) {
      const cell = node.nodeAt(offset);
      if (cell)
        decorations.push(
          Decoration.node(position + 1 + offset, position + 1 + offset + cell.nodeSize, {
            "data-semlo-editor-header-cell": "true",
          }),
        );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

interface ActiveTable {
  node: ProseMirrorNode;
  position: number;
  dom: HTMLElement;
  table: HTMLTableElement;
  map: TableMap;
}

function activeTable(editor: Editor): ActiveTable | null {
  if (editor.isDestroyed) return null;
  try {
    const rect = selectedRect(editor.state);
    const position = rect.tableStart - 1;
    const dom = editor.view.nodeDOM(position);
    if (!(dom instanceof editor.view.dom.ownerDocument.defaultView!.HTMLElement)) return null;
    const table = dom.matches("table") ? (dom as HTMLTableElement) : dom.querySelector<HTMLTableElement>("table");
    return table ? { node: rect.table, position, dom, table, map: rect.map } : null;
  } catch {
    return null;
  }
}

function measuredWidths(table: HTMLTableElement, count: number): number[] {
  const columns = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
  const fallback = Math.max(1, table.getBoundingClientRect().width / Math.max(1, count));
  return Array.from({ length: count }, (_, index) => {
    const width = columns[index]?.getBoundingClientRect().width;
    return Number.isFinite(width) && width && width > 0 ? width : fallback;
  });
}

function dispatchTable(editor: Editor, transaction: Transaction) {
  if (editor.isDestroyed || !editor.isEditable || !transaction.docChanged) return;
  editor.view.dispatch(closeHistory(transaction.scrollIntoView()));
  if (!editor.isDestroyed) {
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
    if (!editor.isDestroyed && editor.isEditable) editor.view.focus();
  }
}

function setTableAttributes(editor: Editor, table: ActiveTable, changes: Record<string, unknown>) {
  if (!editor.isEditable || editor.isDestroyed || editor.state.doc.nodeAt(table.position) !== table.node) return;
  const next = { ...table.node.attrs, ...changes };
  if (
    Object.entries(changes).every(([name, value]) => JSON.stringify(table.node.attrs[name]) === JSON.stringify(value))
  )
    return;
  dispatchTable(editor, editor.state.tr.setNodeMarkup(table.position, undefined, next));
}

function equalizeTableColumns(editor: Editor, table: ActiveTable) {
  if (!editor.isEditable || editor.isDestroyed || editor.state.doc.nodeAt(table.position) !== table.node) return;
  const count = table.map.width;
  const original = widths(table.node.attrs.semloEditorFitWidths);
  const source =
    table.node.attrs.semloEditorFitWidth === true && original?.length === count
      ? original
      : measuredWidths(table.table, count);
  const total = source.reduce((sum, value) => sum + value, 0);
  const average = Math.max(60, total / count);
  const targets = Array.from(
    { length: count },
    (_, index) => Math.round(average * (index + 1)) - Math.round(average * index),
  );
  const tr = editor.state.tr;
  for (const offset of new Set(table.map.map)) {
    const cell = table.node.nodeAt(offset);
    if (!cell) continue;
    const bounds = table.map.findCell(offset);
    const next = targets.slice(bounds.left, bounds.right);
    if (JSON.stringify(cell.attrs.colwidth) === JSON.stringify(next)) continue;
    tr.setNodeMarkup(table.position + 1 + offset, undefined, { ...cell.attrs, colwidth: next });
  }
  if (table.node.attrs.semloEditorFitWidth === true)
    tr.setNodeMarkup(table.position, undefined, { ...table.node.attrs, semloEditorFitWidths: targets });
  dispatchTable(editor, tr);
}

/** Mount the table toolbar outside the editor DOM, preserving the editor selection. */
export function mountTableToolbar(editor: Editor, shell: HTMLElement): () => void {
  const doc = shell.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  const editorDOM = editor.view.dom;
  const toolbar = doc.createElement("div");
  toolbar.className = "semlo-editor-table-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "表格工具栏");
  toolbar.hidden = true;
  const returnButton = doc.createElement("button");
  returnButton.type = "button";
  returnButton.className = "semlo-editor-table-return";
  returnButton.textContent = "‹ 返回文档";
  returnButton.setAttribute("aria-label", "返回文档");
  returnButton.hidden = true;
  let current: ActiveTable | null = null;
  let menu: HTMLDivElement | null = null;
  let palette: HTMLDivElement | null = null;
  let maximized = false;
  let maximizedDom: HTMLElement | null = null;
  let destroyed = false;
  let frame: number | undefined;
  let observed: Element | null = null;

  const button = (label: string, content: string) => {
    const element = doc.createElement("button");
    element.type = "button";
    element.className = "semlo-editor-table-toolbar-button";
    element.setAttribute("aria-label", label);
    element.title = label;
    element.innerHTML = content;
    element.addEventListener("mousedown", (event) => event.preventDefault());
    toolbar.append(element);
    return element;
  };
  const equal = button("列等宽", '<span aria-hidden="true">↔</span><span>列等宽</span>');
  const fit = button("自适应宽度", '<span aria-hidden="true">↔</span><span>自适应宽度</span>');
  const divider = () => {
    const element = doc.createElement("span");
    element.className = "semlo-editor-table-toolbar-divider";
    element.setAttribute("aria-hidden", "true");
    toolbar.append(element);
  };
  divider();
  const maximize = button("最大化表格", '<span aria-hidden="true">⛶</span>');
  const border = button("隐藏边框", '<span aria-hidden="true">▧</span>');
  divider();
  const header = button("标题行列", '<span aria-hidden="true">▦</span>');
  header.setAttribute("aria-haspopup", "menu");
  header.setAttribute("aria-expanded", "false");

  const closeMenu = () => {
    menu?.remove();
    palette?.remove();
    menu = null;
    palette = null;
    header.setAttribute("aria-expanded", "false");
  };
  const exitMaximized = (focus = true) => {
    if (!maximized) return;
    maximized = false;
    maximizedDom?.classList.remove("semlo-editor-table-max-active");
    maximizedDom = null;
    shell.classList.remove("semlo-editor-table-maximized");
    returnButton.hidden = true;
    if (focus && !editor.isDestroyed && editor.isEditable) editor.view.focus();
  };
  const position = () => {
    if (!current || toolbar.hidden) return;
    const rect = current.dom.getBoundingClientRect();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const x = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, win.innerWidth - width - 8));
    const above = rect.top - height - 8;
    const below = rect.bottom + 8;
    const mainToolbar = shell.querySelector<HTMLElement>(":scope > .semlo-editor-toolbar");
    const mainRect = mainToolbar?.getBoundingClientRect();
    const available = (y: number) => {
      if (y < 8 || y + height > win.innerHeight - 8) return false;
      return !(
        mainRect &&
        mainRect.width > 0 &&
        mainRect.height > 0 &&
        x < mainRect.right &&
        x + width > mainRect.left &&
        y < mainRect.bottom &&
        y + height > mainRect.top
      );
    };
    const y = available(above) ? above : available(below) ? below : null;
    toolbar.style.visibility = y === null ? "hidden" : "";
    if (y === null) return;
    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
  };
  const schedulePosition = () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      position();
    });
  };
  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(schedulePosition) : null;
  const updateMenu = () => {
    if (!menu || !current) return;
    menu
      .querySelector<HTMLButtonElement>('[data-table-switch="row"]')
      ?.setAttribute("aria-checked", String(current.node.attrs.semloEditorHeaderRow === true));
    menu
      .querySelector<HTMLButtonElement>('[data-table-switch="column"]')
      ?.setAttribute("aria-checked", String(current.node.attrs.semloEditorHeaderColumn === true));
    const selectedBackground = color(current.node.attrs.semloEditorHeaderBackground) ?? defaultBackground;
    const selectedColor = color(current.node.attrs.semloEditorHeaderColor) ?? defaultForeground;
    palette?.querySelectorAll<HTMLButtonElement>("[data-table-scheme]").forEach((item) => {
      item.setAttribute(
        "aria-pressed",
        String(item.dataset.background === selectedBackground && item.dataset.foreground === selectedColor),
      );
    });
    const backgroundInput = palette?.querySelector<HTMLInputElement>('[data-table-custom="background"]');
    const colorInput = palette?.querySelector<HTMLInputElement>('[data-table-custom="color"]');
    if (backgroundInput && doc.activeElement !== backgroundInput) backgroundInput.value = selectedBackground;
    if (colorInput && doc.activeElement !== colorInput) colorInput.value = selectedColor;
  };
  const refresh = () => {
    if (destroyed || editor.isDestroyed) return;
    const next = editor.isEditable ? activeTable(editor) : null;
    if (maximized && (!next || (current && next.position !== current.position))) exitMaximized(false);
    if (!next) {
      current = null;
      toolbar.hidden = true;
      closeMenu();
      if (observed) resizeObserver?.unobserve(observed);
      observed = null;
      return;
    }
    if (current && current.position !== next.position) closeMenu();
    current = next;
    if (maximized && maximizedDom !== next.dom) {
      maximizedDom?.classList.remove("semlo-editor-table-max-active");
      maximizedDom = next.dom;
      maximizedDom.classList.add("semlo-editor-table-max-active");
    }
    if (observed !== next.dom) {
      if (observed) resizeObserver?.unobserve(observed);
      observed = next.dom;
      resizeObserver?.observe(observed);
    }
    toolbar.hidden = maximized;
    const currentWidths = measuredWidths(next.table, next.map.width);
    equal.hidden = currentWidths.length < 2 || Math.max(...currentWidths) - Math.min(...currentWidths) < 2;
    fit.setAttribute("aria-pressed", String(next.node.attrs.semloEditorFitWidth === true));
    const borderHidden = next.node.attrs.semloEditorBorderHidden === true;
    border.setAttribute("aria-pressed", String(borderHidden));
    border.setAttribute("aria-label", borderHidden ? "显示边框" : "隐藏边框");
    border.title = borderHidden ? "显示边框" : "隐藏边框";
    updateMenu();
    schedulePosition();
  };
  const setAttrs = (changes: Record<string, unknown>) => {
    const table = current;
    if (table) setTableAttributes(editor, table, changes);
  };
  equal.addEventListener("click", () => {
    if (current) equalizeTableColumns(editor, current);
  });
  fit.addEventListener("click", () => {
    if (!current) return;
    const enabled = current.node.attrs.semloEditorFitWidth !== true;
    setAttrs({
      semloEditorFitWidth: enabled,
      semloEditorFitWidths: enabled ? measuredWidths(current.table, current.map.width) : null,
    });
  });
  border.addEventListener("click", () => {
    if (current) setAttrs({ semloEditorBorderHidden: current.node.attrs.semloEditorBorderHidden !== true });
  });
  maximize.addEventListener("click", () => {
    if (!current) return;
    closeMenu();
    maximized = true;
    maximizedDom = current.dom;
    maximizedDom.classList.add("semlo-editor-table-max-active");
    shell.classList.add("semlo-editor-table-maximized");
    returnButton.hidden = false;
    toolbar.hidden = true;
    editor.view.focus();
  });
  returnButton.addEventListener("mousedown", (event) => event.preventDefault());
  returnButton.addEventListener("click", () => {
    exitMaximized();
    refresh();
  });
  header.addEventListener("click", () => {
    if (!current) return;
    if (menu) {
      closeMenu();
      return;
    }
    menu = doc.createElement("div");
    menu.className = "semlo-editor-table-header-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "标题行列");
    header.setAttribute("aria-expanded", "true");
    const addSwitch = (label: string, key: "semloEditorHeaderRow" | "semloEditorHeaderColumn", name: string) => {
      const item = doc.createElement("button");
      item.type = "button";
      item.setAttribute("role", "switch");
      item.setAttribute("aria-label", label);
      item.dataset.tableSwitch = name;
      item.innerHTML = `<span aria-hidden="true">▦</span><span>${label}</span><span class="semlo-editor-table-switch" aria-hidden="true"></span>`;
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        if (current) setAttrs({ [key]: current.node.attrs[key] !== true });
      });
      menu?.append(item);
    };
    addSwitch("标题行", "semloEditorHeaderRow", "row");
    addSwitch("标题列", "semloEditorHeaderColumn", "column");
    const colors = doc.createElement("button");
    colors.type = "button";
    colors.setAttribute("role", "menuitem");
    colors.setAttribute("aria-label", "配色方案");
    colors.setAttribute("aria-haspopup", "dialog");
    colors.innerHTML = '<span aria-hidden="true">▧</span><span>配色方案</span><span aria-hidden="true">A</span>';
    colors.addEventListener("mousedown", (event) => event.preventDefault());
    colors.addEventListener("click", () => {
      if (!menu || !current) return;
      if (palette) {
        palette.remove();
        palette = null;
        return;
      }
      palette = doc.createElement("div");
      palette.className = "semlo-editor-table-color-menu";
      palette.setAttribute("role", "dialog");
      palette.setAttribute("aria-label", "表头配色");
      const swatches = doc.createElement("div");
      swatches.className = "semlo-editor-table-color-swatches";
      for (const [name, background, foreground] of schemes) {
        const item = doc.createElement("button");
        item.type = "button";
        item.setAttribute("aria-label", `${name}配色`);
        item.dataset.tableScheme = name;
        item.dataset.background = background;
        item.dataset.foreground = foreground;
        item.style.backgroundColor = background;
        item.style.color = foreground;
        item.textContent = "A";
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("click", () =>
          setAttrs({ semloEditorHeaderBackground: background, semloEditorHeaderColor: foreground }),
        );
        swatches.append(item);
      }
      palette.append(swatches);
      const label = doc.createElement("div");
      label.className = "semlo-editor-table-color-label";
      label.textContent = "自定义";
      palette.append(label);
      const custom = doc.createElement("div");
      custom.className = "semlo-editor-table-color-custom";
      for (const [name, key] of [
        ["标题文字颜色", "color"],
        ["标题背景颜色", "background"],
      ] as const) {
        const wrapper = doc.createElement("label");
        wrapper.textContent = name;
        const input = doc.createElement("input");
        input.type = "color";
        input.setAttribute("aria-label", name);
        input.dataset.tableCustom = key;
        input.addEventListener("change", () => {
          const value = color(input.value);
          if (value)
            setAttrs(key === "color" ? { semloEditorHeaderColor: value } : { semloEditorHeaderBackground: value });
        });
        wrapper.append(input);
        custom.append(wrapper);
      }
      palette.append(custom);
      menu.append(palette);
      updateMenu();
      const menuRect = menu.getBoundingClientRect();
      palette.classList.toggle(
        "semlo-editor-table-color-menu-left",
        menuRect.right + palette.offsetWidth + 8 > win.innerWidth,
      );
    });
    menu.append(colors);
    toolbar.append(menu);
    updateMenu();
  });
  const outside = (event: Event) => {
    if (menu && !toolbar.contains(event.target as globalThis.Node)) closeMenu();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (palette) {
      palette.remove();
      palette = null;
    } else if (menu) closeMenu();
    else if (maximized) {
      exitMaximized();
      refresh();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const editable = () => refresh();
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (maximized && current && transaction.docChanged && transaction.mapping.mapResult(current.position, 1).deleted)
      exitMaximized(false);
    refresh();
  };
  const rollback = () => {
    if (destroyed) return;
    destroyed = true;
    runCleanupSteps(
      [
        () => exitMaximized(false),
        () => closeMenu(),
        () => {
          if (frame !== undefined) win.cancelAnimationFrame(frame);
        },
        () => resizeObserver?.disconnect(),
        () => editor.off("transaction", onTransaction),
        () => editor.off("selectionUpdate", refresh),
        () => editorDOM.removeEventListener("semlo-editor:editable", editable),
        () => doc.removeEventListener("pointerdown", outside, true),
        () => doc.removeEventListener("keydown", keydown, true),
        () => doc.removeEventListener("scroll", schedulePosition, true),
        () => win.removeEventListener("resize", schedulePosition),
        () => toolbar.remove(),
        () => returnButton.remove(),
      ],
      "Table toolbar cleanup failed",
    );
  };

  try {
    shell.prepend(returnButton);
    doc.body.append(toolbar);
    editor.on("transaction", onTransaction);
    editor.on("selectionUpdate", refresh);
    editorDOM.addEventListener("semlo-editor:editable", editable);
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", keydown, true);
    doc.addEventListener("scroll", schedulePosition, true);
    win.addEventListener("resize", schedulePosition);
    refresh();
    return rollback;
  } catch (error) {
    try {
      rollback();
    } catch (cleanupError) {
      const failures = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
      throw new AggregateError([error, ...failures], "Table toolbar setup and cleanup failed", { cause: error });
    }
    throw error;
  }
}
