import { Extension } from "@tiptap/core";
import { Color, FontFamily, FontSize } from "@tiptap/extension-text-style";

/** The four text gradients offered by the color picker. */
export const TEXT_GRADIENTS = [
  ["#2abcbf", "#3836dd"],
  ["#2249fe", "#c74aa8"],
  ["#ff6f04", "#f330ab"],
  ["#f4aa06", "#e54631"],
] as const;

export function gradientValue(index: number): string {
  const pair = TEXT_GRADIENTS[index];
  return pair ? `linear-gradient(90deg, ${pair[0]}, ${pair[1]})` : "";
}

/** Restrict imported values to our supported gradients before emitting CSS. */
export function validGradient(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return (
    TEXT_GRADIENTS.map((_, index) => gradientValue(index)).find(
      (gradient) => gradient.replace(/\s+/g, "").toLowerCase() === normalized,
    ) ?? null
  );
}

// Tiptap's style parsers return an empty string for missing properties. When
// another textStyle attribute (such as a gradient) creates the span, normalize
// those missing values so HTML and JSON have the same document attributes.
export const SemloEditorColor = Color.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) => ({
      ...group,
      attributes: {
        ...group.attributes,
        color: {
          ...group.attributes.color,
          parseHTML: (element: HTMLElement) => group.attributes.color?.parseHTML?.(element) || null,
        },
      },
    }));
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setColor:
        (color: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { color, semloEditorGradient: null }).run(),
      unsetColor:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { color: null, semloEditorGradient: null }).removeEmptyTextStyle().run(),
    };
  },
});

export const SemloEditorFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) => ({
      ...group,
      attributes: {
        ...group.attributes,
        fontFamily: {
          ...group.attributes.fontFamily,
          parseHTML: (element: HTMLElement) => group.attributes.fontFamily?.parseHTML?.(element) || null,
        },
      },
    }));
  },
});

export const SemloEditorFontSize = FontSize.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((group) => ({
      ...group,
      attributes: {
        ...group.attributes,
        fontSize: {
          ...group.attributes.fontSize,
          parseHTML: (element: HTMLElement) => group.attributes.fontSize?.parseHTML?.(element) || null,
        },
      },
    }));
  },
});

/** Preserve gradient text as a textStyle attribute through JSON and HTML. */
export const TextGradient = Extension.create({
  name: "semloEditorTextGradient",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          semloEditorGradient: {
            default: null,
            parseHTML: (element) => validGradient(element.getAttribute("data-semlo-editor-gradient")),
            renderHTML: (attributes) => {
              const gradient = validGradient(attributes.semloEditorGradient);
              if (!gradient) return {};
              return {
                "data-semlo-editor-gradient": gradient,
                style: `background-image: ${gradient}; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent`,
              };
            },
          },
        },
      },
    ];
  },
});
