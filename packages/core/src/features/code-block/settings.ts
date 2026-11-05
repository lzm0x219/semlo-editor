import type { Editor } from "@tiptap/core";

export type CodeFontSize = 12 | 13 | 14 | 15 | 16 | 19 | 22 | null;
export type CodeIndentWidth = 2 | 4 | 8;
export type CodeIndentMode = "tab" | "space";

export interface CodeBlockSettings {
  codeFontSize: CodeFontSize;
  indentMode: CodeIndentMode;
  indentWidth: CodeIndentWidth;
  wordWrap: boolean;
  showLineNumbers: boolean;
}

export interface CodeBlockPreferences extends CodeBlockSettings {
  theme: string;
  language: string | null;
}

/** The host owns storage, its scope, and any cross-editor synchronization. */
export interface CodeBlockPreferencesAdapter {
  load: () => unknown;
  save: (preferences: CodeBlockPreferences) => void;
}

export const defaultCodeSettings: CodeBlockSettings = {
  codeFontSize: 14,
  indentMode: "space",
  indentWidth: 2,
  wordWrap: false,
  showLineNumbers: true,
};

const fontSizes = [12, 13, 14, 15, 16, 19, 22];
const indentWidths = [2, 4, 8];
const preferencesByEditor = new WeakMap<Editor, CodeBlockPreferences>();
const adaptersByEditor = new WeakMap<Editor, CodeBlockPreferencesAdapter>();

/** Normalize imported data before using it for CSS, menu state, or commands. */
export function readCodeSettings(attrs: Record<string, unknown>): CodeBlockSettings {
  const font = attrs.codeFontSize;
  const width = attrs.indentWidth;
  return {
    codeFontSize: font === null ? null : fontSizes.includes(font as number) ? (font as CodeFontSize) : 14,
    indentMode: attrs.indentMode === "tab" ? "tab" : "space",
    indentWidth: indentWidths.includes(width as number) ? (width as CodeIndentWidth) : 2,
    wordWrap: attrs.wordWrap === true,
    showLineNumbers: attrs.showLineNumbers !== false,
  };
}

export function readCodePreferences(editor: Editor): CodeBlockPreferences {
  return { ...(preferencesByEditor.get(editor) ?? { ...defaultCodeSettings, theme: "light", language: null }) };
}

function normalizeCodePreferences(attrs: Record<string, unknown>): CodeBlockPreferences {
  return {
    ...readCodeSettings(attrs),
    theme: typeof attrs.theme === "string" ? attrs.theme : "light",
    language: typeof attrs.language === "string" ? attrs.language : null,
  };
}

/** Configure once after creating an editor, before inserting its first code block. */
export function configureCodePreferences(editor: Editor, adapter: CodeBlockPreferencesAdapter | null): void {
  if (!adapter) {
    adaptersByEditor.delete(editor);
    return;
  }
  adaptersByEditor.set(editor, adapter);
  try {
    const loaded = adapter.load();
    if (loaded !== null && typeof loaded === "object" && !Array.isArray(loaded))
      preferencesByEditor.set(editor, normalizeCodePreferences(loaded as Record<string, unknown>));
  } catch {
    // Storage may be unavailable; retain this editor's in-memory preferences.
  }
}

export function rememberCodePreferences(editor: Editor, attrs: Record<string, unknown>) {
  const preferences = normalizeCodePreferences(attrs);
  preferencesByEditor.set(editor, preferences);
  try {
    adaptersByEditor.get(editor)?.save({ ...preferences });
  } catch {
    // Saving must not prevent the editor or its in-memory settings from working.
  }
}
