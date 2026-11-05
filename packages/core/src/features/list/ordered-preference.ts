import type { Editor } from "@tiptap/core";

export type PreferredOrderedStyle = "mixed" | "chinese" | "decimal";
const preferences = new WeakMap<Editor, PreferredOrderedStyle>();

export function rememberOrderedStyle(editor: Editor, style: PreferredOrderedStyle): void {
  preferences.set(editor, style);
}

export function preferredOrderedStyle(editor: Editor): PreferredOrderedStyle | null {
  return preferences.get(editor) ?? null;
}
