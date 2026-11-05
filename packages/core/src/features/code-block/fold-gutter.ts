import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import {
  scanCodeFoldables,
  normalizeFolds,
  readCodeFolds,
  toggleCodeFold,
  visibleCodeLines,
  type CodeFoldable,
} from "./folding";
import { readCodeSettings } from "./settings";

export function createCodeFoldGutter({
  code,
  numbers,
  body,
  view,
  getPos,
  node,
}: {
  code: HTMLElement;
  numbers: HTMLElement;
  body: HTMLElement;
  view: EditorView;
  getPos: () => number | undefined;
  node: () => PMNode;
}) {
  const doc = code.ownerDocument,
    win = doc.defaultView;
  const bar = doc.createElement("div");
  bar.className = "semlo-editor-code-fold-gutter";
  bar.contentEditable = "false";
  body.insertBefore(bar, code.parentElement);
  let cachedText = "",
    cachedLanguage: unknown,
    candidates: CodeFoldable[] = [];
  let frame = 0,
    generation = 0,
    destroyed = false;
  let cancelScan: (() => void) | undefined;
  let originalColor: string | undefined, originalHeight: string | undefined;
  const topAt = (offset: number, entries: Array<{ node: Text; start: number; end: number }>, base: number) => {
    let low = 0,
      high = entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (entries[mid].end <= offset) low = mid + 1;
      else high = mid;
    }
    const entry = entries[low];
    if (!entry) return undefined;
    const range = doc.createRange();
    const at = offset - entry.start;
    range.setStart(entry.node, at);
    range.setEnd(entry.node, Math.min(entry.node.length, at + 1));
    const rect = [...range.getClientRects()].find((r) => r.width > 0 || r.height > 0);
    return rect ? rect.top - base : undefined;
  };
  const render = () => {
    frame = 0;
    if (destroyed || !win || !code.isConnected) return;
    const active = bar.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : undefined;
    const focusLine = active?.dataset.foldLine;
    const current = node(),
      text = current.textContent,
      settings = readCodeSettings(current.attrs);
    const position = getPos();
    const folds =
      typeof position === "number"
        ? readCodeFolds(view, position, current)
        : normalizeFolds(current.attrs.folds, text.length);
    const lines = visibleCodeLines(text, folds),
      bounds = code.getBoundingClientRect(),
      gutter = bar.getBoundingClientRect();
    if (!bounds.height) {
      bar.replaceChildren();
      return;
    }
    bar.style.marginLeft = settings.showLineNumbers ? "-16px" : "0px";
    const computed = win.getComputedStyle(code),
      cssHeight = parseFloat(computed.height);
    const scale = cssHeight > 0 ? bounds.height / cssHeight : 1;
    if (folds.length && settings.showLineNumbers) {
      if (originalColor === undefined) originalColor = numbers.style.color;
      if (originalHeight === undefined) originalHeight = numbers.style.height;
      numbers.style.color = "transparent";
      numbers.style.height = `${bounds.height / scale + 8}px`;
      numbers.style.overflow = "hidden";
    } else {
      if (originalColor !== undefined) numbers.style.color = originalColor;
      if (originalHeight !== undefined) numbers.style.height = originalHeight;
      numbers.style.removeProperty("overflow");
      originalColor = undefined;
      originalHeight = undefined;
    }
    const walker = doc.createTreeWalker(code, win.NodeFilter.SHOW_TEXT);
    const entries: Array<{ node: Text; start: number; end: number }> = [];
    let offset = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if (t.parentElement?.closest(".ProseMirror-widget")) continue;
      entries.push({ node: t, start: offset, end: offset + t.length });
      offset += t.length;
    }
    if (offset !== text.length) return;
    const lineHeight = (parseFloat(computed.lineHeight) || 20) * scale;
    const foldMap = new Map(candidates.map((f) => [f.line, f]));
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    for (const fold of folds) {
      let low = 0,
        high = lineStarts.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (lineStarts[mid] <= fold.from) low = mid + 1;
        else high = mid;
      }
      const line = low;
      foldMap.set(line, { line, ...fold });
    }
    const fragment = doc.createDocumentFragment();
    let clipTop = 0,
      clipBottom = win.innerHeight;
    for (let parent = code.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
      if (!/^(auto|scroll|hidden|clip|overlay)$/.test(win.getComputedStyle(parent).overflowY)) continue;
      const rect = parent.getBoundingClientRect();
      clipTop = Math.max(clipTop, rect.top);
      clipBottom = Math.min(clipBottom, rect.bottom);
    }
    if (clipBottom <= clipTop || bounds.bottom < clipTop || bounds.top > clipBottom) {
      bar.replaceChildren();
      return;
    }
    const topFor = (index: number) => {
      const line = lines[index];
      if (!settings.wordWrap) return bounds.top - gutter.top + index * lineHeight;
      if (line.from === text.length) {
        const trailing = code.lastElementChild?.matches("br.ProseMirror-trailingBreak")
          ? code.lastElementChild.getBoundingClientRect()
          : undefined;
        return trailing && trailing.height > 0 ? trailing.top - gutter.top : undefined;
      }
      return topAt(line.from, entries, gutter.top);
    };
    const find = (target: number) => {
      let low = 0,
        high = lines.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const top = topFor(mid);
        if (top !== undefined && top + gutter.top <= target) low = mid + 1;
        else high = mid;
      }
      return Math.max(0, low - 1);
    };
    const first = Math.max(0, find(clipTop) - 2),
      last = Math.min(lines.length - 1, find(clipBottom) + 2);
    for (let i = first; i <= last; i++) {
      const line = lines[i],
        top = topFor(i);
      if (top === undefined || top + gutter.top < clipTop - lineHeight || top + gutter.top > clipBottom + lineHeight)
        continue;
      const candidate = foldMap.get(line.number);
      if (candidate) {
        const folded = folds.some((f) => f.from === candidate.from && f.to === candidate.to);
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "semlo-editor-code-fold-toggle";
        button.dataset.foldLine = String(line.number);
        button.style.top = `${top / scale}px`;
        button.setAttribute("aria-label", `${folded ? "展开" : "折叠"}第 ${line.number} 行代码`);
        button.setAttribute("aria-expanded", String(!folded));
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          const pos = getPos();
          if (typeof pos === "number") toggleCodeFold(view, pos, candidate);
        });
        fragment.append(button);
      }
      if (folds.length && settings.showLineNumbers) {
        const label = doc.createElement("span");
        label.className = "semlo-editor-code-fold-number";
        label.style.top = `${top / scale}px`;
        label.textContent = String(line.number);
        fragment.append(label);
      }
    }
    bar.replaceChildren(fragment);
    if (focusLine) bar.querySelector<HTMLElement>(`[data-fold-line="${focusLine}"]`)?.focus({ preventScroll: true });
  };
  const schedule = () => {
    if (destroyed || !win) return;
    const current = node(),
      text = current.textContent,
      lang = current.attrs.language;
    if (text !== cachedText || lang !== cachedLanguage) {
      cachedText = text;
      cachedLanguage = lang;
      candidates = [];
      const id = ++generation;
      cancelScan?.();
      cancelScan = scanCodeFoldables(text, typeof lang === "string" ? lang : null, win, (result) => {
        if (destroyed || id !== generation) return;
        candidates = result;
        schedule();
      });
    }
    if (frame) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(render);
  };
  const observer = win?.ResizeObserver ? new win.ResizeObserver(schedule) : undefined;
  observer?.observe(code);
  doc.addEventListener("scroll", schedule, true);
  win?.addEventListener("resize", schedule);
  schedule();
  return {
    element: bar,
    schedule,
    destroy() {
      destroyed = true;
      if (frame) win?.cancelAnimationFrame(frame);
      cancelScan?.();
      observer?.disconnect();
      doc.removeEventListener("scroll", schedule, true);
      win?.removeEventListener("resize", schedule);
      bar.remove();
      if (originalColor !== undefined) numbers.style.color = originalColor;
      if (originalHeight !== undefined) numbers.style.height = originalHeight;
      numbers.style.removeProperty("overflow");
    },
  };
}
