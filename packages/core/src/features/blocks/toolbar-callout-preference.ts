const key = "semlo-editor.callout-tone.v1";
const tones = new Set(["gray", "info", "cyan", "green", "lime", "yellow", "orange", "pink", "mauve", "purple"]);
const fallback = new WeakMap<Window, string>();

/** Read the last user-chosen color from same-origin browser storage. */
export function readCalloutTonePreference(doc: Document): string | null {
  const win = doc.defaultView;
  if (!win) return null;
  try {
    const value = win.localStorage.getItem(key);
    return value && tones.has(value) ? value : null;
  } catch {
    return fallback.get(win) ?? null;
  }
}

/** Remember only explicit choices; invalid tones and inaccessible storage are harmless. */
export function rememberCalloutTone(doc: Document, value: string): void {
  const win = doc.defaultView;
  if (!win || !tones.has(value)) return;
  fallback.set(win, value);
  try {
    win.localStorage.setItem(key, value);
  } catch {
    // The preference remains available to editors in this window for this session.
  }
}
