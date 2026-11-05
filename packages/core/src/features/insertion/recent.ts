import type { Editor } from "@tiptap/core";

// Store only command IDs, never document content. If storage is unavailable,
// keep recent choices for this document's lifetime instead.
const recentStorageKey = "semlo-editor.recent-commands.v1";
const recentFallback = new WeakMap<Document, string[]>();
const inaccessibleStorage = new WeakSet<Document>();
export function recentIds(doc: Document): string[] {
  if (inaccessibleStorage.has(doc)) return recentFallback.get(doc) ?? [];
  if (!doc.defaultView) return recentFallback.get(doc) ?? [];
  let raw: string | null | undefined;
  try {
    raw = doc.defaultView?.localStorage.getItem(recentStorageKey);
  } catch {
    inaccessibleStorage.add(doc);
    return recentFallback.get(doc) ?? [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter(
              (value): value is string => typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(value),
            ),
          ),
        ].slice(0, 3)
      : [];
  } catch {
    return [];
  }
}
export function remember(editor: Editor, id: string) {
  const doc = editor.view.dom.ownerDocument;
  const canonical = /^columns[234]$/.test(id) ? "columns" : id;
  const next = [canonical, ...recentIds(doc).filter((value) => value !== canonical)].slice(0, 3);
  recentFallback.set(doc, next);
  if (inaccessibleStorage.has(doc)) return;
  try {
    doc.defaultView?.localStorage.setItem(recentStorageKey, JSON.stringify(next));
  } catch {
    inaccessibleStorage.add(doc);
  }
}
