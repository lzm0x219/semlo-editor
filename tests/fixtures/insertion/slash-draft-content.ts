import type { JSONContent } from "@tiptap/core";

export const paragraph = (text?: string): JSONContent => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

const body = () => [paragraph(), paragraph("容器后文")];
const summary = (): JSONContent => ({ type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] });

export const slashDraftContexts: Array<{ name: string; node: () => JSONContent }> = [
  { name: "引用", node: () => ({ type: "blockquote", content: body() }) },
  { name: "高亮块", node: () => ({ type: "callout", attrs: { tone: "pink" }, content: body() }) },
  {
    name: "折叠正文",
    node: () => ({
      type: "details",
      attrs: { open: true },
      content: [summary(), { type: "detailsContent", content: body() }],
    }),
  },
  {
    name: "折叠正文内的高亮块",
    node: () => ({
      type: "details",
      attrs: { open: true },
      content: [
        summary(),
        { type: "detailsContent", content: [{ type: "callout", attrs: { tone: "green" }, content: body() }] },
      ],
    }),
  },
];
