import type { JSONContent } from "@tiptap/core";

/** Return document images in their rendered order, including inside text blocks. */
export function imageNodes(document: JSONContent): JSONContent[] {
  const result: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === "image") result.push(node);
    node.content?.forEach(visit);
  };
  visit(document);
  return result;
}
