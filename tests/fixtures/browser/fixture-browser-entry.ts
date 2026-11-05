// Bundle the built public entry together with the internal helpers used by
// browser regressions. This lets a browser load the package without Vite's
// development-only dependency rewriting.
export * from "../../../packages/core/dist/index.js";
export * from "../../../packages/core/src/features/text/paragraph-layout.ts";
export { applyDocumentFont, DocumentFontExtension } from "../../../packages/core/src/features/text/document-font.ts";
export { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit.ts";
export { CodeCard } from "../../../packages/core/src/features/code-block/extension.ts";
export { autoIndentCodeBlock, isAutoIndentPending } from "../../../packages/core/src/features/code-block/keyboard.ts";
export {
  referenceCodeIndent,
  referenceCodeIndentJSON,
  applyReferenceCodeIndent,
  referenceCodeIndentMappings,
  compareCodeIndentRebases,
  attachCodeIndentDecoration,
  codeIndentDecorations,
  codeIndentUndoDepth,
  restoreOriginalAutolink,
} from "../../../packages/core/tests/code-indent-reference.ts";
export { Step } from "@tiptap/pm/transform";
export { Plugin, PluginKey } from "@tiptap/pm/state";
export { canSkipCodeIndentAutolink } from "../../../packages/core/src/features/code-block/indent-step.ts";
export { showCodeProgress } from "../../../packages/core/src/features/code-block/feedback.ts";
export { LocalFontName } from "../../../packages/core/src/features/text/local-fonts.ts";
export { FontSizeShortcuts } from "../../../packages/core/src/features/text/font-size-shortcuts.ts";
export { openHeadingNumberingMenu } from "../../../packages/core/src/features/heading/numbering-menu.ts";
export { renderDiagram } from "../../../packages/core/src/features/drawing/diagram/render.ts";
export { Editor, Extension } from "@tiptap/core";
export { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
export { TextStyle, FontSize, FontFamily, Color } from "@tiptap/extension-text-style";
export { default as Highlight } from "@tiptap/extension-highlight";
export { default as Subscript } from "@tiptap/extension-subscript";
export { default as Superscript } from "@tiptap/extension-superscript";
