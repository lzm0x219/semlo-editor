import { textblockTypeInputRule } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";

import { createCodeFoldingPlugin, normalizeFolds } from "./folding";
import { codeLowlight } from "./languages";
import { createCodeBlockNodeView } from "./node-view";
import { readCodePreferences, readCodeSettings } from "./settings";

export const CodeCard = CodeBlockLowlight.extend({
  // Font selection uses textStyle; code blocks keep other mark types disabled.
  marks: "textStyle",
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createCodeFoldingPlugin(this.editor)];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      folds: {
        default: [],
        rendered: false,
        parseHTML: (element) => {
          try {
            return normalizeFolds(
              JSON.parse(element.getAttribute("data-code-folds") ?? "[]"),
              element.textContent?.length ?? 0,
            );
          } catch {
            return [];
          }
        },
      },
      title: { default: "", rendered: false, parseHTML: (element) => element.getAttribute("data-title") ?? "" },
      theme: {
        default: "light",
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-theme") ?? "light",
      },
      collapsed: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
      },
      headerHidden: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-code-header-hidden") === "true",
      },
      codeFontSize: {
        default: 14,
        rendered: false,
        parseHTML: (element) => {
          const value = element.getAttribute("data-code-font-size");
          return readCodeSettings({ codeFontSize: value === "inherit" ? null : value === null ? 14 : Number(value) })
            .codeFontSize;
        },
      },
      indentMode: {
        default: "space",
        rendered: false,
        parseHTML: (element) =>
          readCodeSettings({ indentMode: element.getAttribute("data-code-indent-mode") }).indentMode,
      },
      indentWidth: {
        default: 2,
        rendered: false,
        parseHTML: (element) =>
          readCodeSettings({ indentWidth: Number(element.getAttribute("data-code-indent-width")) }).indentWidth,
      },
      wordWrap: {
        default: false,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-code-wrap") === "true",
      },
      showLineNumbers: {
        default: true,
        rendered: false,
        parseHTML: (element) => element.getAttribute("data-code-line-numbers") !== "false",
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const settings = readCodeSettings(node.attrs);
    return [
      "pre",
      {
        ...HTMLAttributes,
        "data-title": node.attrs.title,
        "data-code-folds": JSON.stringify(normalizeFolds(node.attrs.folds, node.content.size)),
        "data-theme": node.attrs.theme,
        "data-collapsed": String(node.attrs.collapsed),
        "data-code-header-hidden": String(node.attrs.headerHidden === true),
        "data-code-font-size": settings.codeFontSize === null ? "inherit" : String(settings.codeFontSize),
        "data-code-indent-mode": settings.indentMode,
        "data-code-indent-width": String(settings.indentWidth),
        "data-code-wrap": String(settings.wordWrap),
        "data-code-line-numbers": String(settings.showLineNumbers),
      },
      ["code", { class: node.attrs.language ? `language-${node.attrs.language}` : null }, 0],
    ];
  },
  addCommands() {
    return {
      setCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, { ...readCodePreferences(this.editor), ...attributes }),
      toggleCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph", { ...readCodePreferences(this.editor), ...attributes }),
    };
  },
  addInputRules() {
    return [/^```([\w+#./-]+)?[\s\n]$/, /^~~~([\w+#./-]+)?[\s\n]$/].map((find) =>
      textblockTypeInputRule({
        find,
        type: this.type,
        getAttributes: (match) => ({
          ...readCodePreferences(this.editor),
          ...(match[1] ? { language: match[1] } : {}),
        }),
      }),
    );
  },
  addNodeView() {
    return createCodeBlockNodeView();
  },
}).configure({ lowlight: codeLowlight, defaultLanguage: "plaintext" });
