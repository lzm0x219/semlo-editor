import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { headingNumberMarkers } from "../../features/heading/numbering";

interface OutlineHeading {
  pos: number;
  level: number;
  label: string;
  depth: number;
  parent: number | null;
  hasChildren: boolean;
}

let outlineSequence = 0;

/** Mount a document outline. Its expanded state is interface state, not document data. */
export function mountOutline(editor: Editor, container: HTMLElement, revealHeading: (pos: number) => void): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const root = doc.createElement("nav");
  root.className = "semlo-editor-outline";
  root.setAttribute("aria-label", "文档大纲");
  const header = doc.createElement("div");
  header.className = "semlo-editor-outline-header";
  const title = doc.createElement("span");
  title.className = "semlo-editor-outline-title";
  title.textContent = "大纲";
  const actions = doc.createElement("div");
  actions.className = "semlo-editor-outline-actions";
  const visibility = doc.createElement("button");
  visibility.type = "button";
  visibility.className = "semlo-editor-outline-action";
  visibility.setAttribute("aria-label", "隐藏大纲");
  visibility.title = "隐藏大纲";
  visibility.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2.5"/><path d="M4 16 16 4"/></svg>';
  const foldAll = doc.createElement("button");
  foldAll.type = "button";
  foldAll.className = "semlo-editor-outline-action";
  foldAll.setAttribute("aria-label", "折叠全部层级");
  foldAll.title = "折叠全部层级";
  foldAll.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h10M7 10h10M7 15h10"/><path d="M3 5h1M3 10h1M3 15h1"/></svg>';
  const compact = doc.createElement("button");
  compact.type = "button";
  compact.className = "semlo-editor-outline-compact";
  compact.setAttribute("aria-label", "展开大纲");
  compact.setAttribute("aria-expanded", "false");
  compact.title = "展开大纲";
  const list = doc.createElement("div");
  list.className = "semlo-editor-outline-list";
  list.id = `semlo-editor-outline-list-${++outlineSequence}`;
  compact.setAttribute("aria-controls", list.id);
  actions.append(visibility, foldAll);
  header.append(title, actions);
  header.hidden = true;
  list.hidden = true;
  root.classList.add("is-compact");
  root.append(compact, header, list);
  container.append(root);

  let headings: OutlineHeading[] = [];
  let folded = new Set<number>();
  let active: number | null = null;
  let frame: number | undefined;
  let destroyed = false;
  let expanded = false;
  let hovering = false;
  const content = container.querySelector<HTMLElement>(":scope > .semlo-editor-content");
  const toolbar = container.closest(".semlo-editor")?.querySelector<HTMLElement>(".semlo-editor-toolbar");
  const syncToolbarHeight = () =>
    root.style.setProperty("--semlo-editor-outline-toolbar-height", `${toolbar?.offsetHeight ?? 0}px`);
  const toolbarObserver = toolbar && win?.ResizeObserver ? new win.ResizeObserver(syncToolbarHeight) : null;
  if (toolbar) toolbarObserver?.observe(toolbar);
  syncToolbarHeight();

  // Hosts may override the content padding, leaving no safe space for a rail.
  // Move its entry above the document when it would otherwise cover text.
  const syncGutter = () => {
    if (!win || !content) return;
    const contentStyle = win.getComputedStyle(content);
    const clearance =
      parseFloat(win.getComputedStyle(root).getPropertyValue("--semlo-editor-outline-rail-clearance")) || 58;
    const available =
      container.getBoundingClientRect().right -
      content.getBoundingClientRect().right +
      (parseFloat(contentStyle.paddingRight) || 0) +
      (parseFloat(contentStyle.borderRightWidth) || 0);
    root.classList.toggle("is-inline", available + 0.5 < clearance);
  };
  const gutterObserver = content && win?.ResizeObserver ? new win.ResizeObserver(syncGutter) : null;
  if (content) {
    gutterObserver?.observe(container);
    gutterObserver?.observe(content);
  }
  const styleObserver = content && win?.MutationObserver ? new win.MutationObserver(syncGutter) : null;
  if (content) styleObserver?.observe(content, { attributes: true, attributeFilter: ["class", "style"] });
  win?.addEventListener("resize", syncGutter, { passive: true });
  syncGutter();

  const setExpanded = (next: boolean, focus = false) => {
    if (destroyed || !headings.length) return;
    expanded = next;
    root.classList.toggle("is-compact", !next);
    root.classList.toggle("is-expanded", next);
    compact.setAttribute("aria-expanded", String(next));
    compact.hidden = next;
    header.hidden = !next;
    list.hidden = !next;
    if (focus) (next ? visibility : compact).focus({ preventScroll: true });
  };

  const pointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    hovering = true;
    setExpanded(true);
  };
  const pointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    hovering = false;
    if (!root.contains(doc.activeElement)) setExpanded(false);
  };
  const focusOut = () => {
    queueMicrotask(() => {
      if (!destroyed && expanded && !hovering && !root.contains(doc.activeElement)) setExpanded(false);
    });
  };
  const outsidePointer = (event: PointerEvent) => {
    if (expanded && event.target instanceof (win?.Node ?? Node) && !root.contains(event.target)) setExpanded(false);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false, true);
  };

  const collect = () => {
    const found: OutlineHeading[] = [],
      stack: OutlineHeading[] = [],
      markers = headingNumberMarkers(editor.state);
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "heading") return;
      const text = node.textBetween(0, node.content.size, " ", "\ufffc").trim();
      if (!text) return false;
      const level = Number(node.attrs.level) || 1;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1] ?? null;
      if (parent) parent.hasChildren = true;
      const marker = markers.get(pos);
      const label = marker === undefined ? text : `${marker} ${text}`;
      const item = { pos, level, label, depth: stack.length, parent: parent?.pos ?? null, hasChildren: false };
      found.push(item);
      stack.push(item);
      return false;
    });
    return found;
  };

  const updateActive = () => {
    frame = undefined;
    if (destroyed || editor.isDestroyed) return;
    const line = Math.max(0, toolbar?.getBoundingClientRect().bottom ?? 0) + 24;
    let chosen: number | null = null;
    for (const item of headings) {
      const node = editor.view.nodeDOM(item.pos);
      if (!(node instanceof (win?.HTMLElement ?? HTMLElement)) || !node.getClientRects().length) continue;
      if (chosen === null) chosen = item.pos;
      if (node.getBoundingClientRect().top <= line) chosen = item.pos;
      else break;
    }
    if (chosen === active) return;
    active = chosen;
    for (const button of list.querySelectorAll<HTMLButtonElement>(".semlo-editor-outline-link")) {
      if (Number(button.dataset.pos) === active) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
    }
  };
  const scheduleActive = () => {
    if (!win || frame !== undefined || destroyed) return;
    frame = win.requestAnimationFrame(updateActive);
  };
  const render = (focusPos?: number) => {
    headings = collect();
    root.hidden = headings.length === 0;
    if (!headings.length) {
      expanded = false;
      hovering = false;
      root.classList.remove("is-expanded");
      root.classList.add("is-compact");
      compact.hidden = false;
      compact.setAttribute("aria-expanded", "false");
      header.hidden = true;
      list.hidden = true;
    }
    const marks = doc.createDocumentFragment();
    for (const item of headings) {
      const line = doc.createElement("span");
      line.className = "semlo-editor-outline-mark";
      line.setAttribute("aria-hidden", "true");
      line.style.width = `${item.depth === 0 ? 24 : item.depth === 1 ? 16 : 11}px`;
      marks.append(line);
    }
    compact.replaceChildren(marks);
    const validParents = new Set(headings.filter((item) => item.hasChildren).map((item) => item.pos));
    folded = new Set([...folded].filter((pos) => validParents.has(pos)));
    const allFolded = validParents.size > 0 && [...validParents].every((pos) => folded.has(pos));
    foldAll.disabled = validParents.size === 0;
    foldAll.setAttribute("aria-label", allFolded ? "展开全部层级" : "折叠全部层级");
    foldAll.title = allFolded ? "展开全部层级" : "折叠全部层级";
    const hiddenParents = new Set<number>();
    const rows = doc.createDocumentFragment();
    for (const item of headings) {
      if (item.parent !== null && (hiddenParents.has(item.parent) || folded.has(item.parent))) {
        hiddenParents.add(item.pos);
        continue;
      }
      const row = doc.createElement("div");
      row.className = "semlo-editor-outline-row";
      row.style.paddingLeft = `${8 + item.depth * 17}px`;
      if (item.hasChildren) {
        const toggle = doc.createElement("button");
        toggle.type = "button";
        toggle.className = "semlo-editor-outline-toggle";
        toggle.setAttribute("aria-label", `${folded.has(item.pos) ? "展开" : "折叠"} ${item.label}`);
        toggle.setAttribute("aria-expanded", String(!folded.has(item.pos)));
        toggle.dataset.pos = String(item.pos);
        toggle.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m4 3 4 3-4 3Z"/></svg>';
        toggle.addEventListener("mousedown", (event) => event.preventDefault());
        toggle.addEventListener("click", (event) => {
          if (folded.has(item.pos)) folded.delete(item.pos);
          else folded.add(item.pos);
          render(event.detail === 0 ? item.pos : undefined);
        });
        row.append(toggle);
      } else {
        const spacer = doc.createElement("span");
        spacer.className = "semlo-editor-outline-spacer";
        spacer.setAttribute("aria-hidden", "true");
        row.append(spacer);
      }
      const link = doc.createElement("button");
      link.type = "button";
      link.className = "semlo-editor-outline-link";
      link.textContent = item.label;
      link.dataset.pos = String(item.pos);
      link.title = item.label;
      if (item.pos === active) link.setAttribute("aria-current", "location");
      link.addEventListener("mousedown", (event) => event.preventDefault());
      link.addEventListener("click", () => {
        revealHeading(item.pos);
        const target = editor.view.nodeDOM(item.pos);
        if (target instanceof (win?.HTMLElement ?? HTMLElement))
          target.scrollIntoView({ block: "start", inline: "nearest" });
        active = item.pos;
        for (const button of list.querySelectorAll<HTMLButtonElement>(".semlo-editor-outline-link")) {
          if (Number(button.dataset.pos) === active) button.setAttribute("aria-current", "location");
          else button.removeAttribute("aria-current");
        }
      });
      row.append(link);
      rows.append(row);
    }
    list.replaceChildren(rows);
    if (focusPos !== undefined)
      list
        .querySelector<HTMLButtonElement>(`.semlo-editor-outline-toggle[data-pos="${focusPos}"]`)
        ?.focus({ preventScroll: true });
    scheduleActive();
  };
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) {
      const next = new Set<number>();
      for (const pos of folded) {
        // Heading attribute changes replace its opening token, but preserve its
        // content. Map inside the heading so a numbering change keeps it folded.
        const mapped = transaction.mapping.mapResult(pos + 1, 1);
        if (mapped.deletedAcross) continue;
        const resolved = editor.state.doc.resolve(mapped.pos);
        if (resolved.parent.type.name === "heading") next.add(resolved.before());
      }
      folded = next;
      active = null;
      render();
    } else scheduleActive();
  };
  visibility.addEventListener("click", (event) => setExpanded(false, event.detail === 0));
  compact.addEventListener("click", (event) => setExpanded(true, event.detail === 0));
  foldAll.addEventListener("click", (event) => {
    const parents = headings.filter((item) => item.hasChildren).map((item) => item.pos);
    folded = parents.every((pos) => folded.has(pos)) ? new Set() : new Set(parents);
    render();
    if (event.detail === 0) foldAll.focus({ preventScroll: true });
  });
  for (const button of [visibility, foldAll, compact])
    button.addEventListener("mousedown", (event) => event.preventDefault());
  root.addEventListener("pointerenter", pointerEnter);
  root.addEventListener("pointerleave", pointerLeave);
  root.addEventListener("focusout", focusOut);
  root.addEventListener("keydown", keyboard);
  doc.addEventListener("pointerdown", outsidePointer, true);
  editor.on("transaction", onTransaction);
  doc.addEventListener("scroll", scheduleActive, true);
  win?.addEventListener("scroll", scheduleActive, { passive: true });
  win?.addEventListener("resize", scheduleActive, { passive: true });
  render();
  return () => {
    if (destroyed) return;
    destroyed = true;
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
    toolbarObserver?.disconnect();
    gutterObserver?.disconnect();
    styleObserver?.disconnect();
    win?.removeEventListener("resize", syncGutter);
    editor.off("transaction", onTransaction);
    root.removeEventListener("pointerenter", pointerEnter);
    root.removeEventListener("pointerleave", pointerLeave);
    root.removeEventListener("focusout", focusOut);
    root.removeEventListener("keydown", keyboard);
    doc.removeEventListener("pointerdown", outsidePointer, true);
    doc.removeEventListener("scroll", scheduleActive, true);
    win?.removeEventListener("scroll", scheduleActive);
    win?.removeEventListener("resize", scheduleActive);
    root.remove();
  };
}
