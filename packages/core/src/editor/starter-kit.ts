import { flattenExtensions, mergeAttributes, type Extensions, type Node as TiptapNode } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

import { canSkipCodeIndentAutolink } from "../features/code-block/indent-step";

/** Allow the combinations observed in Yuque while retaining other code exclusions. */
export function createStarterKitWithCodeFonts(extraExtensions: Extensions) {
  const compatibleCodeMarks = new Set([
    "textStyle",
    "bold",
    "italic",
    "underline",
    "strike",
    "subscript",
    "superscript",
    "highlight",
    "link",
  ]);
  const excluded = new Set([
    "code",
    ...flattenExtensions(extraExtensions)
      .filter((extension) => extension.type === "mark" && !compatibleCodeMarks.has(extension.name))
      .map((extension) => extension.name),
  ]);

  return StarterKit.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map((extension) => {
        if (extension.type === "node" && extension.name === "paragraph")
          return (extension as TiptapNode).extend({
            parseHTML() {
              return [
                { tag: "p[data-semlo-editor-preserve-tab]", preserveWhitespace: "full", priority: 1000 },
                ...(this.parent?.() ?? []),
              ];
            },
            renderHTML(props) {
              if (!props.node.textContent.includes("\t")) return this.parent?.(props) ?? ["p", props.HTMLAttributes, 0];
              const HTMLAttributes = mergeAttributes(props.HTMLAttributes, {
                "data-semlo-editor-preserve-tab": "",
                style: "white-space: pre-wrap;",
              });
              return this.parent?.({ ...props, HTMLAttributes }) ?? ["p", HTMLAttributes, 0];
            },
          });
        if (extension.type === "node" && extension.name === "heading")
          return (extension as TiptapNode).extend({
            parseHTML() {
              const marker = [1, 2, 3, 4, 5, 6]
                .map(
                  (level) => `h${level}[data-semlo-editor-heading-numbering] > span[data-semlo-editor-heading-marker]`,
                )
                .join(",");
              return [{ tag: marker, ignore: true, priority: 1000 }, ...(this.parent?.() ?? [])];
            },
          });
        if (extension.type === "mark" && extension.name === "code")
          // Keep code outside links and textStyle, matching the editor's
          // inline rendering while letting inner font styles take precedence.
          return extension.extend({ priority: 1001, excludes: Array.from(excluded).join(" ") });
        if (extension.type === "mark" && extension.name === "link")
          return extension.extend({
            addProseMirrorPlugins() {
              return (this.parent?.() ?? []).map((plugin) => {
                const key = (plugin as Plugin & { key?: string }).key;
                const append = plugin.spec.appendTransaction;
                if (!key?.match(/^autolink\$(?:\d+)?$/) || !append) return plugin;
                return new Plugin({
                  ...plugin.spec,
                  appendTransaction(transactions, oldState, newState) {
                    const changed = transactions.filter((transaction) => transaction.docChanged);
                    const link = newState.schema.marks.link;
                    if (
                      link &&
                      changed.length &&
                      changed.every((transaction) => canSkipCodeIndentAutolink(transaction, link))
                    )
                      return null;
                    return append.call(this, transactions, oldState, newState);
                  },
                });
              });
            },
          });
        return extension;
      });
    },
  }).configure({
    link: { openOnClick: false, autolink: true },
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: false,
    trailingNode: false,
  });
}
