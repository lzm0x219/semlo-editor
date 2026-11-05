import { Extension, type CommandProps, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import { linkPopup } from "../../platform/dom/popup-owner";
import {
  applyDocumentFont,
  parseLocalFontVariants,
  readLocalFontVariants,
  type LocalFontVariants,
} from "./document-font";

type LocalFont = { family?: unknown; fullName?: unknown; style?: unknown; postscriptName?: unknown };
const fontCacheKey = Symbol.for("@semlo-editor/core/local-font-cache/v2");
type FontWindow = Window & { queryLocalFonts?: () => Promise<LocalFont[]>; [fontCacheKey]?: FontCache };
type FontChoice = {
  name: string;
  family: string;
  cssName: string;
  css: string;
  postscriptName: string | null;
  style: string;
};
type FontRequest = { promise: Promise<FontChoice[]>; observers: number };
type FontCache = {
  api: NonNullable<FontWindow["queryLocalFonts"]>;
  fonts?: FontChoice[];
  pending?: FontRequest;
  generation: number;
};
const fontCaches = new WeakMap<FontWindow, FontCache>();

// Separately loaded core copies share the in-memory state through
// the owning Window. The WeakMap remains a fallback for non-extensible hosts.
function readCache(win: FontWindow): FontCache | undefined {
  try {
    return fontCaches.get(win) ?? win[fontCacheKey];
  } catch {
    return fontCaches.get(win);
  }
}
function writeCache(win: FontWindow, cache: FontCache): void {
  try {
    Object.defineProperty(win, fontCacheKey, { value: cache, writable: true, configurable: true });
  } catch {
    fontCaches.set(win, cache);
  }
}
function clearCache(win: FontWindow): void {
  fontCaches.delete(win);
  try {
    delete win[fontCacheKey];
  } catch {
    /* Non-extensible host: no shared state was written. */
  }
}

/** A family is stored as one quoted CSS family, never as a list or declaration. */
function cssFamily(value: unknown): { name: string; css: string } | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  // Control characters must not enter a CSS font-family value.
  // oxlint-disable-next-line no-control-regex
  if (!name || name.length > 160 || /[;{}<>\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(name)) return null;
  return { name, css: `"${name.replace(/[\\"]/g, "\\$&")}"` };
}

/** Compare single CSS font names across quoted, unquoted and escaped forms. */
function parsedFontFamily(value: unknown): { kind: "name" | "list"; value: string } | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  const quote = text[0];
  const quoted = (quote === '"' || quote === "'") && text.length > 1 && text.endsWith(quote);
  if (quoted) text = text.slice(1, -1);
  let decoded = "",
    whitespace = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\") {
      if (!quoted && text[i] === ",") return { kind: "list", value: text };
      if (!quoted && /[\t\n\r\f ]/.test(text[i])) {
        if (!whitespace) decoded += " ";
        whitespace = true;
      } else {
        decoded += text[i];
        whitespace = false;
      }
      continue;
    }
    whitespace = false;
    i++;
    if (i >= text.length) {
      decoded += "\\";
      break;
    }
    if (!/[0-9a-f]/i.test(text[i])) {
      decoded += text[i];
      continue;
    }
    let hex = text[i];
    while (hex.length < 6 && i + 1 < text.length && /[0-9a-f]/i.test(text[i + 1])) hex += text[++i];
    const point = parseInt(hex, 16);
    decoded += String.fromCodePoint(
      point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? point : 0xfffd,
    );
    if (i + 1 < text.length && /[\t\n\r\f ]/.test(text[i + 1])) i++;
  }
  return { kind: "name", value: decoded };
}

function fontFamilyKey(value: unknown): string | null {
  const parsed = parsedFontFamily(value);
  return parsed ? `${parsed.kind}:${parsed.value.toLowerCase()}` : null;
}

type ActiveFont = { kind: "default" | "mixed" } | { kind: "font"; family: string; name: string | null };

/** A selection can contain multiple textStyle marks, or inherit the document font. */
function activeFont(editor: Editor, hasTextSelection: boolean): ActiveFont {
  const { state } = editor;
  const documentFamily = cssFamily(state.doc.attrs.semloEditorDocumentFontFamily)?.css ?? null;
  const documentName =
    typeof state.doc.attrs.semloEditorDocumentFontName === "string"
      ? state.doc.attrs.semloEditorDocumentFontName
      : null;
  if (!hasTextSelection) {
    const family = fontFamilyKey(documentFamily);
    return family ? { kind: "font", family, name: documentName } : { kind: "default" };
  }

  let family: string | null | undefined;
  const names = new Set<string>();
  let missingName = false;
  let mixed = false;
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isText) return;
      const mark = node.marks.find((item) => item.type.name === "textStyle");
      const inline = typeof mark?.attrs.fontFamily === "string" ? mark.attrs.fontFamily.trim() : "";
      const inherits = !inline || /^(inherit|unset)$/i.test(inline);
      const current = fontFamilyKey(inherits ? documentFamily : inline);
      const display = inherits
        ? documentName
        : typeof mark?.attrs.semloEditorFontName === "string"
          ? mark.attrs.semloEditorFontName
          : null;
      if (family === undefined) family = current;
      else if (family !== current) mixed = true;
      if (current && display) names.add(display);
      else if (current) missingName = true;
    });
  }
  if (mixed || names.size > 1) return { kind: "mixed" };
  return family
    ? { kind: "font", family, name: missingName ? null : (names.values().next().value ?? null) }
    : { kind: "default" };
}

function selectedFont(active: ActiveFont, fonts: FontChoice[]): FontChoice | null {
  if (active.kind !== "font") return null;
  const matches = fonts.filter((font) => fontFamilyKey(font.css) === active.family);
  const named = active.name ? matches.filter((font) => font.name === active.name) : [];
  if (named.length === 1) return named[0];
  return matches.length === 1 ? matches[0] : null;
}

type FontSpec = { family: string; variants: LocalFontVariants | null; alias: string };

/** Preserve the chosen face as a CSS family, without changing serialized fontFamily. */
function fontSpec(family: unknown, name: unknown, rawVariants: unknown): FontSpec | null {
  if (!cssFamily(name)) return null;
  const parsed = parsedFontFamily(family);
  if (!parsed || parsed.kind !== "name" || !cssFamily(parsed.value)) return null;
  let variants: LocalFontVariants | null;
  try {
    variants = readLocalFontVariants(rawVariants);
  } catch {
    return null;
  }
  const value = JSON.stringify([parsed.value, variants]);
  const bytes = new TextEncoder().encode(value);
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const alias = `semlo-editor-local-${encoded}`;
  return { family: parsed.value, variants, alias };
}

type FontRegistration = { count: number; faces: FontFace[]; rule: Text };
type FontRegistry = { aliases: Map<string, FontRegistration>; style: HTMLStyleElement };
const registeredFonts = new WeakMap<Document, FontRegistry>();

/** local() works without repeating the local-font enumeration permission. */
function retainFontSpec(doc: Document, spec: FontSpec): void {
  const win = doc.defaultView;
  if (!win || typeof win.FontFace !== "function" || !doc.fonts) return;
  let registry = registeredFonts.get(doc);
  if (!registry) {
    const container = doc.head ?? doc.body;
    if (!container) return;
    const style = doc.createElement("style");
    style.setAttribute("data-semlo-editor-local-fonts", "");
    container.append(style);
    registry = { aliases: new Map(), style };
    registeredFonts.set(doc, registry);
  }
  const existing = registry.aliases.get(spec.alias);
  if (existing) {
    existing.count++;
    return;
  }
  const family = cssFamily(spec.family);
  if (!family) return;
  const candidates: Array<[string | undefined, string, string]> = [
    [spec.family, "400", "normal"],
    [spec.variants?.bold, "700", "normal"],
    [spec.variants?.italic, "400", "italic"],
    [spec.variants?.boldItalic, "700", "italic"],
  ];
  const faces: FontFace[] = [];
  try {
    for (const [value, weight, style] of candidates) {
      if (!value) continue;
      const name = cssFamily(value);
      if (!name) throw new Error("Invalid font name");
      const face = new win.FontFace(spec.alias, `local(${name.css})`, { weight, style });
      doc.fonts.add(face);
      faces.push(face);
    }
    const rule = doc.createTextNode(
      `.semlo-editor-prose[data-semlo-editor-document-face="${spec.alias}"],.semlo-editor-prose [data-semlo-editor-local-face="${spec.alias}"]{font-family:"${spec.alias}",${family.css}!important;font-synthesis:weight style;}\n`,
    );
    registry.style.append(rule);
    registry.aliases.set(spec.alias, { count: 1, faces, rule });
  } catch {
    for (const face of faces) doc.fonts.delete(face);
    if (!registry.aliases.size) {
      registry.style.remove();
      registeredFonts.delete(doc);
    }
    // Retain the original family when font registration is unavailable.
  }
}

function releaseFontSpec(doc: Document, alias: string): void {
  const registry = registeredFonts.get(doc),
    entry = registry?.aliases.get(alias);
  if (!registry || !entry || --entry.count > 0) return;
  for (const face of entry.faces) doc.fonts.delete(face);
  entry.rule.remove();
  registry.aliases.delete(alias);
  if (!registry.aliases.size) {
    registry.style.remove();
    registeredFonts.delete(doc);
  }
}

type FontCounts = Map<string, { spec: FontSpec; count: number }>;
function countFont(counts: FontCounts, spec: FontSpec | null, amount: number): void {
  if (!spec || !amount) return;
  const current = counts.get(spec.alias);
  if (current) current.count += amount;
  else counts.set(spec.alias, { spec, count: amount });
}

function countNodeFonts(counts: FontCounts, node: ProseMirrorNode, amount: number): void {
  for (const mark of node.marks) {
    if (mark.type.name !== "textStyle") continue;
    const spec = fontSpec(mark.attrs.fontFamily, mark.attrs.semloEditorFontName, mark.attrs.semloEditorFontVariants);
    countFont(counts, spec, amount);
  }
}

function documentFontSpec(node: ProseMirrorNode): FontSpec | null {
  const family = cssFamily(node.attrs.semloEditorDocumentFontFamily);
  return (
    family && fontSpec(family.css, node.attrs.semloEditorDocumentFontName, node.attrs.semloEditorDocumentFontVariants)
  );
}

function countRangeFonts(counts: FontCounts, doc: ProseMirrorNode, from: number, to: number, direction: 1 | -1): void {
  if (from >= to) return;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText)
      countNodeFonts(counts, node, direction * (Math.min(to, pos + node.nodeSize) - Math.max(from, pos)));
  });
}

/** The readable label travels with textStyle; fontFamily remains the CSS value. */
export const LocalFontName = Extension.create({
  name: "semloEditorLocalFontName",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          semloEditorFontName: {
            default: null,
            parseHTML: (element) => cssFamily(element.getAttribute("data-semlo-editor-font-name"))?.name ?? null,
            renderHTML: (attributes) => {
              const name = cssFamily(attributes.semloEditorFontName)?.name;
              if (!name) return {};
              const spec = fontSpec(attributes.fontFamily, name, attributes.semloEditorFontVariants);
              return spec
                ? { "data-semlo-editor-font-name": name, "data-semlo-editor-local-face": spec.alias }
                : { "data-semlo-editor-font-name": name };
            },
          },
          semloEditorFontVariants: {
            default: null,
            parseHTML: (element) => {
              try {
                return parseLocalFontVariants(element.getAttribute("data-semlo-editor-font-variants"));
              } catch {
                return null;
              }
            },
            renderHTML: (attributes) => {
              try {
                const variants = readLocalFontVariants(attributes.semloEditorFontVariants);
                return variants ? { "data-semlo-editor-font-variants": JSON.stringify(variants) } : {};
              } catch {
                return {};
              }
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontFamily:
        (fontFamily: string) =>
        ({ chain }: CommandProps) =>
          chain().setMark("textStyle", { fontFamily, semloEditorFontName: null, semloEditorFontVariants: null }).run(),
      unsetFontFamily:
        () =>
        ({ chain }: CommandProps) =>
          chain()
            .setMark("textStyle", { fontFamily: null, semloEditorFontName: null, semloEditorFontVariants: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          attributes(state): Record<string, string> {
            const spec = documentFontSpec(state.doc);
            return spec ? { "data-semlo-editor-document-face": spec.alias } : {};
          },
        },
        view(view) {
          const doc = view.dom.ownerDocument;
          const held: FontCounts = new Map();
          const apply = (changes: FontCounts) => {
            for (const [alias, change] of changes) {
              const previous = held.get(alias)?.count ?? 0,
                next = previous + change.count;
              if (next <= 0) {
                if (previous > 0) releaseFontSpec(doc, alias);
                held.delete(alias);
              } else {
                if (!previous) retainFontSpec(doc, change.spec);
                held.set(alias, { spec: change.spec, count: next });
              }
            }
          };
          const initial: FontCounts = new Map();
          countFont(initial, documentFontSpec(view.state.doc), 1);
          countRangeFonts(initial, view.state.doc, 0, view.state.doc.content.size, 1);
          apply(initial);
          return {
            update(next, previous) {
              if (next.state.doc === previous.doc) return;
              const changes: FontCounts = new Map();
              countFont(changes, documentFontSpec(previous.doc), -1);
              countFont(changes, documentFontSpec(next.state.doc), 1);
              const start = previous.doc.content.findDiffStart(next.state.doc.content);
              if (start !== null) {
                const end = previous.doc.content.findDiffEnd(next.state.doc.content);
                // Identical text around an insertion can make the two diffs overlap.
                const overlap = end ? Math.max(0, start - Math.min(end.a, end.b)) : 0;
                countRangeFonts(changes, previous.doc, start, end ? end.a + overlap : previous.doc.content.size, -1);
                countRangeFonts(changes, next.state.doc, start, end ? end.b + overlap : next.state.doc.content.size, 1);
              }
              apply(changes);
            },
            destroy() {
              for (const alias of held.keys()) releaseFontSpec(doc, alias);
              held.clear();
            },
          };
        },
      }),
    ];
  },
});
function fontChoice(entry: LocalFont): FontChoice | null {
  const family = cssFamily(entry?.family);
  const postscript = cssFamily(entry?.postscriptName);
  const cssName = postscript ?? family;
  if (!cssName) return null;
  const fullName = typeof entry.fullName === "string" ? entry.fullName.trim() : "";
  const display = fullName ? cssFamily(fullName) : (family ?? postscript);
  if (!display) return null;
  const style = typeof entry.style === "string" ? entry.style.trim() : "";
  return {
    name: display.name,
    family: family?.name ?? "",
    cssName: cssName.name,
    css: cssName.css,
    postscriptName: postscript?.name ?? null,
    style,
  };
}

/** Map only unambiguous faces reported in the same family; unknown styles keep the selected face. */
function variantsForFont(selected: FontChoice, fonts: FontChoice[]): LocalFontVariants | null {
  if (!selected.family || !selected.postscriptName) return null;
  const kind = (style: string): string => style.toLowerCase().replace(/[\s_-]+/g, "");
  const base = kind(selected.style);
  if (!["regular", "normal", "bold", "italic", "bolditalic", "italicbold"].includes(base)) return null;
  const sibling = (...styles: string[]) => {
    const candidates = new Set(
      fonts
        .filter((font) => font.family === selected.family && font.postscriptName && styles.includes(kind(font.style)))
        .map((font) => font.postscriptName!),
    );
    return candidates.size === 1 ? (candidates.values().next().value as string) : undefined;
  };
  const variants: LocalFontVariants = {};
  if (base === "regular" || base === "normal") {
    variants.bold = sibling("bold");
    variants.italic = sibling("italic");
    variants.boldItalic = sibling("bolditalic", "italicbold");
  } else if (base === "bold") {
    variants.italic = sibling("bolditalic", "italicbold");
    variants.boldItalic = variants.italic;
  } else if (base === "italic") {
    variants.italic = selected.postscriptName;
    variants.bold = sibling("bolditalic", "italicbold");
    variants.boldItalic = variants.bold;
  } else {
    variants.bold = selected.postscriptName;
    variants.italic = selected.postscriptName;
    variants.boldItalic = selected.postscriptName;
  }
  // Omit absent keys so the stored map is stable and validates on roundtrip.
  for (const key of ["bold", "italic", "boldItalic"] as const) if (!variants[key]) delete variants[key];
  return Object.keys(variants).length ? variants : null;
}

function cacheFor(win: FontWindow): FontCache | null {
  const api = win.queryLocalFonts;
  if (typeof api !== "function") {
    clearCache(win);
    return null;
  }
  let cache = readCache(win);
  if (!cache || cache.api !== api) {
    cache = { api, generation: 0 };
    writeCache(win, cache);
  }
  return cache;
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
}
function staleRequest(): Error {
  const error = new Error("Font request superseded");
  error.name = "StaleFontRequestError";
  return error;
}

/** Invoke the browser API synchronously in the toolbar/refresh click handler. */
function requestFonts(win: FontWindow, cache: FontCache, refresh: boolean): FontRequest {
  if (!refresh && cache.pending) return cache.pending;
  const generation = ++cache.generation;
  const request: FontRequest = { observers: 0, promise: undefined as unknown as Promise<FontChoice[]> };
  cache.pending = request;
  let read: Promise<LocalFont[]>;
  try {
    read = cache.api.call(win);
  } catch (error) {
    read = Promise.reject(error);
  }
  request.promise = Promise.resolve(read).then(
    (result) => {
      if (!Array.isArray(result)) throw new Error("Invalid font list");
      if (readCache(win) !== cache || cache.generation !== generation) throw staleRequest();
      const unique = new Map<string, FontChoice>();
      for (const entry of result) {
        const font = fontChoice(entry);
        if (!font) continue;
        const key = font.postscriptName
          ? `postscript:${font.postscriptName}`
          : `fallback:${font.family}\0${font.name}\0${font.style}`;
        if (!unique.has(key)) unique.set(key, font);
      }
      const fonts = Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      if (request.observers) cache.fonts = fonts;
      return fonts;
    },
    (error) => {
      if (readCache(win) !== cache || cache.generation !== generation) throw staleRequest();
      if (errorName(error) === "NotAllowedError" || errorName(error) === "SecurityError") cache.fonts = undefined;
      throw error;
    },
  );
  request.promise.then(
    () => {
      if (cache.pending === request) cache.pending = undefined;
    },
    () => {
      if (cache.pending === request) cache.pending = undefined;
    },
  );
  return request;
}

/** Opens a picker and reads fonts on the user's toolbar click when needed. */
export function openLocalFonts(editor: Editor, anchor: HTMLElement): () => void {
  if (editor.isDestroyed || !editor.isEditable) return () => {};
  const doc = anchor.ownerDocument;
  const win = doc.defaultView as FontWindow | null;
  const view = editor.view;
  const viewDOM = view.dom;
  const initialSelection = editor.state.selection;
  const hasTextSelection =
    !initialSelection.empty &&
    initialSelection.ranges.some(
      ({ $from, $to }) => editor.state.doc.textBetween($from.pos, $to.pos, "", "").length > 0,
    );
  const canApply = initialSelection.empty || hasTextSelection;
  const selectionBookmark = initialSelection.getBookmark();
  const active = activeFont(editor, hasTextSelection);
  const panel = doc.createElement("div");
  panel.className = "semlo-editor-local-font-menu";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "选择字体");
  const searchRow = doc.createElement("div");
  searchRow.className = "semlo-editor-local-font-search-row";
  const search = doc.createElement("input");
  search.type = "search";
  search.placeholder = "搜索字体";
  search.setAttribute("aria-label", "搜索字体");
  search.disabled = true;
  const read = doc.createElement("button");
  read.type = "button";
  read.className = "semlo-editor-local-font-read";
  read.setAttribute("aria-label", "刷新本机字体");
  read.title = "刷新本机字体";
  read.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2.2 5.1"/></svg>';
  searchRow.append(search, read);
  const list = doc.createElement("div");
  list.className = "semlo-editor-local-font-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "字体列表");
  const status = doc.createElement("div");
  status.className = "semlo-editor-local-font-status";
  status.setAttribute("role", "status");
  panel.append(searchRow, list, status);
  doc.body.append(panel);
  const unlinkPopup = linkPopup(anchor, panel);
  anchor.setAttribute("aria-expanded", "true");
  const position = () => {
    const bounds = anchor.getBoundingClientRect(),
      viewportWidth = win?.innerWidth ?? 1000,
      viewportHeight = win?.innerHeight ?? 800;
    panel.style.left = `${Math.max(8, Math.min(bounds.left, viewportWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${bounds.bottom + panel.offsetHeight + 6 > viewportHeight && bounds.top > panel.offsetHeight ? bounds.top - panel.offsetHeight - 6 : Math.max(8, Math.min(bounds.bottom + 6, viewportHeight - panel.offsetHeight - 8))}px`;
  };
  const cache = win ? cacheFor(win) : null;
  let closed = false,
    loading = false,
    loaded = cache?.fonts !== undefined,
    waitingLong = false;
  let errorMessage = "",
    requestVersion = 0;
  let waitTimer: number | undefined;
  let revealFrame: number | undefined;
  let revealPending = true;
  let fonts: FontChoice[] = cache?.fonts ?? [];
  let detachRequest = () => {};
  const clearWait = () => {
    if (waitTimer !== undefined) win?.clearTimeout(waitTimer);
    waitTimer = undefined;
  };
  const cancelReveal = () => {
    revealPending = false;
    if (revealFrame !== undefined) win?.cancelAnimationFrame(revealFrame);
    revealFrame = undefined;
  };

  // Adjust the list itself, not scrollIntoView(), which can also scroll the page.
  // Long lists use content-visibility, so their layout can settle over several frames.
  const revealSelected = () => {
    if (!revealPending || !loaded || !win || closed) return;
    const selected = list.querySelector<HTMLElement>('button[role="option"][aria-selected="true"]');
    if (!selected) {
      cancelReveal();
      return;
    }
    let attempts = 0,
      stableFrames = 0,
      previousGeometry = "";
    let expectedScrollTop = list.scrollTop;
    const step = () => {
      revealFrame = undefined;
      if (!revealPending || closed || !selected.isConnected || !list.contains(selected)) return;
      // 在排队期间发生的外部滚动优先，不能再用旧定位覆盖新的浏览位置。
      if (Math.abs(list.scrollTop - expectedScrollTop) > 0.5) {
        cancelReveal();
        return;
      }
      const container = list.getBoundingClientRect(),
        row = selected.getBoundingClientRect();
      const top = container.top + list.clientTop,
        bottom = top + list.clientHeight;
      const visible = row.top >= top - 1 && row.bottom <= bottom + 1;
      if (visible) {
        const geometry = `${list.scrollTop}:${list.scrollHeight}:${list.clientHeight}:${row.top - top}:${row.height}`;
        stableFrames = geometry === previousGeometry ? stableFrames + 1 : 1;
        previousGeometry = geometry;
      } else {
        stableFrames = 0;
        previousGeometry = "";
        list.scrollTop += row.top - top - (list.clientHeight - row.height) / 2;
        expectedScrollTop = list.scrollTop;
      }
      if (++attempts >= 30 || stableFrames >= 4) {
        cancelReveal();
        return;
      }
      revealFrame = win.requestAnimationFrame(step);
    };
    if (revealFrame !== undefined) win.cancelAnimationFrame(revealFrame);
    revealFrame = win.requestAnimationFrame(step);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    cancelReveal();
    clearWait();
    detachRequest();
    unlinkPopup();
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", keyboard, true);
    viewDOM.removeEventListener("semlo-editor:editable", editableChanged);
    editor.off("destroy", close);
    editor.off("transaction", transactionChanged);
    fonts = [];
  };
  const outside = (event: Event) => {
    if (!panel.contains(event.target as globalThis.Node) && !anchor.contains(event.target as globalThis.Node)) close();
  };
  const editableChanged = () => {
    if (!editor.isEditable) close();
  };
  const transactionChanged = ({
    transaction,
    appendedTransactions = [],
  }: {
    transaction: { docChanged: boolean };
    appendedTransactions?: { docChanged: boolean }[];
  }) => {
    if (transaction.docChanged || appendedTransactions.some((item) => item.docChanged)) close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || (!view.isDestroyed && view.composing)) return;
    if (event.key === "Escape") {
      const target = event.target as globalThis.Node | null;
      const owner = viewDOM.closest(".semlo-editor");
      if (!target || (!panel.contains(target) && !anchor.contains(target) && !owner?.contains(target))) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      if (!editor.isDestroyed) editor.view.focus();
      return;
    }
    if (!panel.contains(event.target as globalThis.Node)) return;
    cancelReveal();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(list.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'));
    if (!options.length) return;
    const index = options.indexOf(doc.activeElement as HTMLButtonElement);
    event.preventDefault();
    options[
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : options.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
    ].focus();
  };
  const select = (choice: FontChoice | null) => {
    if (closed || editor.isDestroyed || !editor.isEditable || !canApply) return;
    const familyName = choice?.cssName ?? null,
      displayName = choice?.name ?? null;
    const variants = choice ? variantsForFont(choice, fonts) : null;
    close();
    if (!hasTextSelection) {
      if (applyDocumentFont(editor, familyName, displayName, variants)) editor.commands.focus();
      return;
    }
    const selection = selectionBookmark.resolve(editor.state.doc);
    if (selection.empty) return;
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor
      .chain()
      .focus()
      .setMark("textStyle", {
        fontFamily: familyName ? (cssFamily(familyName)?.css ?? null) : null,
        semloEditorFontName: displayName,
        semloEditorFontVariants: variants,
      })
      .removeEmptyTextStyle()
      .run();
  };
  const draw = () => {
    if (closed) return;
    search.disabled = !loaded;
    read.disabled = loading && !waitingLong;
    read.hidden = typeof win?.queryLocalFonts !== "function";
    const rows = doc.createDocumentFragment();
    const selected = selectedFont(active, fonts);
    const option = (
      name: string,
      family: string | null,
      checked: boolean,
      familyName = name,
      displayFamily = familyName,
      choice: FontChoice | null = null,
    ) => {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "semlo-editor-local-font-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-label", name);
      row.setAttribute("aria-selected", String(canApply && checked));
      row.disabled = !canApply;
      row.title =
        family && (familyName !== name || displayFamily !== name)
          ? [name, displayFamily, familyName]
              .filter((value, index, values) => value && values.indexOf(value) === index)
              .join(" · ")
          : name;
      const label = doc.createElement("span");
      label.className = "semlo-editor-local-font-option-label";
      label.textContent = name;
      const preview = doc.createElement("span");
      preview.className = "semlo-editor-local-font-preview";
      preview.textContent = "Aa 字";
      preview.setAttribute("aria-hidden", "true");
      if (family) preview.style.fontFamily = family;
      const mark = doc.createElement("span");
      mark.className = "semlo-editor-local-font-check";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = row.getAttribute("aria-selected") === "true" ? "✓" : "";
      row.append(label, preview, mark);
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => select(choice));
      rows.append(row);
    };
    option("默认字体", null, active.kind === "default");
    const query = search.value.trim().toLocaleLowerCase();
    const matching = fonts.filter(
      (font) =>
        font.name.toLocaleLowerCase().includes(query) ||
        font.family.toLocaleLowerCase().includes(query) ||
        font.postscriptName?.toLocaleLowerCase().includes(query) ||
        font.style.toLocaleLowerCase().includes(query),
    );
    for (const font of matching) option(font.name, font.css, font === selected, font.cssName, font.family, font);
    list.replaceChildren(rows);
    if (!canApply) status.textContent = "请选择文字或将光标置于正文，再设置字体。";
    else if (loading)
      status.textContent = waitingLong
        ? "仍在等待浏览器授权；若没有授权提示，可使用支持本机字体访问的 Chrome。"
        : "正在读取本机字体…";
    else if (errorMessage) status.textContent = errorMessage;
    else if (typeof win?.queryLocalFonts !== "function") status.textContent = "当前浏览器不支持读取本机字体";
    else if (!loaded) status.textContent = "字体列表仅保存在当前页面，不会上传";
    else if (!matching.length) status.textContent = query ? "没有找到匹配的字体" : "没有找到可用字体";
    else status.textContent = "";
    position();
    revealSelected();
  };
  read.addEventListener("mousedown", (event) => event.preventDefault());
  const load = (refresh: boolean) => {
    if (closed || !editor.isEditable || !win) return;
    const currentCache = cacheFor(win);
    if (!currentCache) {
      draw();
      return;
    }
    if (!refresh && currentCache.fonts !== undefined) {
      fonts = currentCache.fonts;
      loaded = true;
      errorMessage = "";
      draw();
      return;
    }
    clearWait();
    detachRequest();
    const version = ++requestVersion;
    loading = true;
    waitingLong = false;
    errorMessage = "";
    draw();
    waitTimer = win.setTimeout(() => {
      if (!closed && loading && version === requestVersion) {
        waitingLong = true;
        draw();
      }
    }, 5000);
    const request = requestFonts(win, currentCache, refresh);
    request.observers++;
    let detached = false;
    detachRequest = () => {
      if (!detached) {
        detached = true;
        request.observers--;
      }
    };
    request.promise.then(
      (result) => {
        if (closed || version !== requestVersion) return;
        clearWait();
        detachRequest();
        fonts = result;
        loaded = true;
        loading = false;
        draw();
        if (doc.activeElement === anchor || doc.activeElement === doc.body) search.focus({ preventScroll: true });
      },
      (error) => {
        if (closed || version !== requestVersion) return;
        clearWait();
        detachRequest();
        loading = false;
        const name = errorName(error);
        if (name === "NotAllowedError" || name === "SecurityError") {
          if (readCache(win) === currentCache) currentCache.fonts = undefined;
          fonts = [];
          loaded = false;
          errorMessage = "字体访问被拒绝，请检查浏览器权限";
        } else if (name === "StaleFontRequestError") {
          const latest = cacheFor(win)?.fonts;
          fonts = latest ?? [];
          loaded = latest !== undefined;
          errorMessage = loaded ? "" : "字体列表已更新，请重新读取";
        } else errorMessage = "读取字体失败，请重试";
        draw();
      },
    );
  };
  read.addEventListener("click", () => {
    cancelReveal();
    load(true);
  });
  search.addEventListener("input", () => {
    cancelReveal();
    draw();
  });
  list.addEventListener("wheel", cancelReveal, { passive: true });
  list.addEventListener("touchstart", cancelReveal, { passive: true });
  list.addEventListener("pointerdown", cancelReveal);
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", keyboard, true);
  viewDOM.addEventListener("semlo-editor:editable", editableChanged);
  editor.on("destroy", close);
  editor.on("transaction", transactionChanged);
  draw();
  if (cache?.fonts !== undefined) search.focus({ preventScroll: true });
  else load(false);
  return close;
}
