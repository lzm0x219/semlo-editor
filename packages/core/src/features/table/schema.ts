import type { TagParseRule } from "@tiptap/pm/model";

// Table serialization includes structural HTML elements which are transparent
// to ProseMirror's normal parser but otherwise trip Tiptap's strict catch-all.
export const tableValidationRules: TagParseRule[] = [
  ...["colgroup", "thead", "tbody", "tfoot"].map((tag) => ({ tag: `table > ${tag}`, skip: true })),
  { tag: "table > colgroup > col", ignore: true },
];
