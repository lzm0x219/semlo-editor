import type { JSONContent } from "@tiptap/core";

export function sequencePasteContent(level = 1): JSONContent {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          semloEditorOrderedStyle: "mixed",
          semloEditorListSequences: {
            version: 1,
            sequences: [
              { id: "R", start: 1, origin: "initial" },
              { id: "A", start: 1, origin: "initial" },
              { id: "B", start: 1, origin: "restart" },
            ],
          },
        },
        content: ["父", "甲开头", "乙中段", "丙结尾", "丁后续"].map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index ? level : 0,
            semloEditorListSequence: index === 0 ? "R" : index === 1 ? "A" : "B",
            semloEditorListRestart: index === 2,
          },
          content: [
            {
              type: "paragraph",
              attrs: { semloEditorLineHeight: "2" },
              content: [
                {
                  type: "text",
                  text,
                  ...(index === 1 ? { marks: [{ type: "bold" }] } : index === 2 ? { marks: [{ type: "italic" }] } : {}),
                },
              ],
            },
          ],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "footer" }] },
    ],
  };
  if (level === 0) doc.content![0].content!.shift();
  return doc;
}

export function linkedTypedPasteContent(gap: "bulletList" | "taskList" | "heading"): JSONContent {
  const source = sequencePasteContent();
  const list = source.content![0];
  const version = gap === "heading" ? 3 : 2;
  const registry = list.attrs!.semloEditorListSequences;
  const left: JSONContent = {
    ...list,
    attrs: { ...list.attrs, semloEditorListSequenceLink: `v${version}:_:edge` },
    content: list.content!.slice(0, 2),
  };
  const remaining = structuredClone(list.content!.slice(2));
  remaining[0].attrs = { ...remaining[0].attrs, semloEditorListSequence: "A", semloEditorListRestart: false };
  const right: JSONContent = {
    ...list,
    attrs: {
      ...list.attrs,
      semloEditorListSequences: {
        ...registry,
        sequences: registry.sequences.map((entry: { id: string; start: number }) =>
          entry.id === "A" ? { ...entry, start: 2 } : entry,
        ),
      },
      semloEditorListSequenceLink: `v${version}:edge:_`,
    },
    content: remaining,
  };
  const text = gap === "heading" ? "标题间隔" : gap === "taskList" ? "待办间隔" : "无序间隔";
  const paragraph = { type: "paragraph", content: [{ type: "text", text }] };
  const between: JSONContent =
    gap === "heading"
      ? { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] }
      : {
          type: gap,
          content: [{ type: gap === "taskList" ? "taskItem" : "listItem", content: [paragraph] }],
        };
  return { type: "doc", content: [left, between, right, source.content![1]] };
}
