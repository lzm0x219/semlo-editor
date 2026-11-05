import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";

export type LocalFontVariants = { bold?: string; italic?: string; boldItalic?: string };
export type DocumentFont = { family: string | null; name: string | null; variants: LocalFontVariants | null };
const familyAttribute = "semloEditorDocumentFontFamily";
const nameAttribute = "semloEditorDocumentFontName";
const variantsAttribute = "semloEditorDocumentFontVariants";

/** The document stores one font family, never an arbitrary CSS declaration. */
function fontName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  // Control characters must not enter a CSS font-family value.
  // oxlint-disable-next-line no-control-regex
  if (!name || name.length > 160 || /[;{}<>\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(name)) return null;
  return name;
}

function cssFont(name: string): string {
  return `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

/** Accept only the small set of local faces we can use for emphasis. */
export function readLocalFontVariants(value: unknown): LocalFontVariants | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid local font variants");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["bold", "italic", "boldItalic"].includes(key)))
    throw new Error("Invalid local font variants");
  const variants: LocalFontVariants = {};
  for (const key of ["bold", "italic", "boldItalic"] as const) {
    if (!Object.hasOwn(record, key)) continue;
    const name = fontName(record[key]);
    if (!name) throw new Error("Invalid local font variants");
    variants[key] = name;
  }
  return Object.keys(variants).length ? variants : null;
}

export function parseLocalFontVariants(value: string | null): LocalFontVariants | null {
  if (value === null) return null;
  if (value.length > 1024) throw new Error("Invalid local font variants");
  try {
    return readLocalFontVariants(JSON.parse(value));
  } catch {
    throw new Error("Invalid local font variants");
  }
}

export function readDocumentFont(attrs: Record<string, unknown>): DocumentFont {
  const rawFamily = attrs[familyAttribute],
    rawName = attrs[nameAttribute];
  const family = rawFamily == null ? null : fontName(rawFamily);
  const name = rawName == null ? null : fontName(rawName);
  if ((rawFamily != null && !family) || (rawName != null && !name)) throw new Error("Invalid document font");
  const variants = readLocalFontVariants(attrs[variantsAttribute]);
  return { family, name: family ? name : null, variants: family ? variants : null };
}

/** Persist the document default in the document node, so history can undo it. */
export const DocumentFontExtension = Extension.create({
  name: "semloEditorDocumentFont",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          [familyAttribute]: { default: null },
          [nameAttribute]: { default: null },
          [variantsAttribute]: { default: null },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          attributes: (state): Record<string, string> => {
            let family: string | null = null;
            try {
              family = readDocumentFont(state.doc.attrs).family;
            } catch {
              /* Invalid JSON must not become CSS. */
            }
            return family
              ? { style: `font-family: ${cssFont(family)};`, "data-semlo-editor-document-font-active": "true" }
              : {};
          },
        },
      }),
    ];
  },
});

/** Apply a whole-document font in one transaction, retaining other inline styles. */
export function applyDocumentFont(
  editor: Editor,
  familyName: string | null,
  displayName: string | null,
  faces: LocalFontVariants | null = null,
): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const family = familyName == null ? null : fontName(familyName);
  const name = displayName == null ? null : fontName(displayName);
  if ((familyName != null && !family) || (displayName != null && !name)) return false;
  let variants: LocalFontVariants | null;
  try {
    variants = family ? readLocalFontVariants(faces) : null;
  } catch {
    return false;
  }
  const effectiveName = family ? name : null;
  const { state } = editor;
  const tr = state.tr;
  if (state.doc.attrs[familyAttribute] !== family) tr.setDocAttribute(familyAttribute, family);
  if (state.doc.attrs[nameAttribute] !== effectiveName) tr.setDocAttribute(nameAttribute, effectiveName);
  if (JSON.stringify(state.doc.attrs[variantsAttribute] ?? null) !== JSON.stringify(variants))
    tr.setDocAttribute(variantsAttribute, variants);
  const textStyle = state.schema.marks.textStyle;
  if (textStyle) {
    state.doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = textStyle.isInSet(node.marks);
      if (!mark || (!mark.attrs.fontFamily && !mark.attrs.semloEditorFontName && !mark.attrs.semloEditorFontVariants))
        return;
      const attrs = { ...mark.attrs, fontFamily: null, semloEditorFontName: null, semloEditorFontVariants: null };
      tr.removeMark(pos, pos + node.nodeSize, mark);
      if (Object.values(attrs).some((value) => value !== null && value !== undefined))
        tr.addMark(pos, pos + node.nodeSize, textStyle.create(attrs));
    });
    if (state.storedMarks) {
      const marks = state.storedMarks.flatMap((mark) => {
        if (
          mark.type !== textStyle ||
          (!mark.attrs.fontFamily && !mark.attrs.semloEditorFontName && !mark.attrs.semloEditorFontVariants)
        )
          return [mark];
        const attrs = { ...mark.attrs, fontFamily: null, semloEditorFontName: null, semloEditorFontVariants: null };
        return Object.values(attrs).some((value) => value !== null && value !== undefined)
          ? [textStyle.create(attrs)]
          : [];
      });
      tr.setStoredMarks(marks);
    }
  }
  if (tr.steps.length || tr.storedMarksSet) editor.view.dispatch(closeHistory(tr));
  return true;
}

/** Recognize only the one wrapper emitted by serializeDocumentHTML. */
export function extractDocumentFontHTML(html: string, doc: Document): { html: string; font: DocumentFont } | null {
  const template = doc.createElement("template");
  template.innerHTML = html;
  const relevant = Array.from(template.content.childNodes).filter(
    (node) => node.nodeType !== 8 && (node.nodeType !== 3 || node.textContent?.trim()),
  );
  if (relevant.length !== 1 || relevant[0].nodeType !== 1) return null;
  const wrapper = relevant[0] as HTMLElement;
  if (wrapper.tagName !== "DIV" || !wrapper.hasAttribute("data-semlo-editor-document-font")) return null;
  const family = fontName(wrapper.getAttribute("data-semlo-editor-document-font"));
  const rawName = wrapper.getAttribute("data-semlo-editor-document-font-name");
  const name = rawName === null ? null : fontName(rawName);
  if (!family || (rawName !== null && !name)) throw new Error("Invalid document font");
  const variants = parseLocalFontVariants(wrapper.getAttribute("data-semlo-editor-document-font-variants"));
  // Standalone HTML needs an explicit inheritance rule on code elements.
  // Remove only our generated decoration before parsing back into the model.
  for (const element of wrapper.querySelectorAll<HTMLElement>(
    "pre[data-semlo-editor-document-font-inherit],code[data-semlo-editor-document-font-inherit]",
  )) {
    element.removeAttribute("data-semlo-editor-document-font-inherit");
    if (element.style.fontFamily === "inherit") element.style.removeProperty("font-family");
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  return { html: wrapper.innerHTML, font: { family, name, variants } };
}

export function serializeDocumentHTML(editor: Editor, doc: Document): string {
  const html = editor.getHTML();
  let font: DocumentFont;
  try {
    font = readDocumentFont(editor.state.doc.attrs);
  } catch {
    return html;
  }
  if (!font.family) return html;
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("data-semlo-editor-document-font", font.family);
  if (font.name) wrapper.setAttribute("data-semlo-editor-document-font-name", font.name);
  if (font.variants) wrapper.setAttribute("data-semlo-editor-document-font-variants", JSON.stringify(font.variants));
  wrapper.style.fontFamily = cssFont(font.family);
  wrapper.innerHTML = html;
  for (const element of wrapper.querySelectorAll<HTMLElement>("pre,code")) {
    element.setAttribute("data-semlo-editor-document-font-inherit", "");
    element.style.fontFamily = "inherit";
  }
  return wrapper.outerHTML;
}

export function withDocumentFontAttrs(attrs: Record<string, unknown>, font: DocumentFont): Record<string, unknown> {
  return { ...attrs, [familyAttribute]: font.family, [nameAttribute]: font.name, [variantsAttribute]: font.variants };
}
