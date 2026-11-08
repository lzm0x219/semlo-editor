import type { JSONContent } from "@tiptap/core";

export function sequenceClipboardContent(sameSequence = false, five = false): JSONContent {
  const names = ["父", "甲开头", "乙中段", "丙结尾", ...(five ? ["丁后续", "戊最后"] : [])];
  return {
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
              ...(!sameSequence ? [{ id: "B", start: 1, origin: "restart" }] : []),
              ...(five && !sameSequence ? [{ id: "C", start: 1, origin: "restart" }] : []),
            ],
          },
        },
        content: names.map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index === 0 ? 0 : 1,
            semloEditorListSequence: index === 0 ? "R" : sameSequence || index === 1 ? "A" : index < 4 ? "B" : "C",
            semloEditorListRestart: !sameSequence && (index === 2 || index === 4),
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
      { type: "paragraph" },
    ],
  };
}

/** 原生端点样本：单父四子，乙显式重启，丁仍属于乙/丙序列。 */
export function sequenceClipboardBoundaryContent(level: 1 | 2 = 1): JSONContent {
  const json = sequenceClipboardContent();
  const list = json.content![0];
  const last = list.content![3];
  list.content!.push({
    ...last,
    attrs: { ...last.attrs },
    content: [
      { type: "paragraph", attrs: { semloEditorLineHeight: "2" }, content: [{ type: "text", text: "丁后续" }] },
    ],
  });
  list.content!.forEach((item, index) => {
    if (index > 0) item.attrs!.semloEditorListIndent = level;
  });
  return json;
}

/** 一组根项与直接子项，便于覆盖跨父子和跨父项的复制。 */
export function sequenceClipboardCrossParentContent(): JSONContent {
  const json = sequenceClipboardContent(true, true);
  const list = json.content![0];
  list.attrs!.semloEditorListSequences = {
    version: 1,
    sequences: [
      { id: "R", start: 1, origin: "initial" },
      { id: "A", start: 1, origin: "initial" },
      { id: "B", start: 1, origin: "initial" },
    ],
  };
  const names = ["父甲", "子甲", "子乙", "父乙", "子丙", "子丁"];
  const levels = [0, 1, 1, 0, 1, 1];
  const ids = ["R", "A", "A", "R", "B", "B"];
  list.content!.forEach((item, index) => {
    item.attrs!.semloEditorListIndent = levels[index];
    item.attrs!.semloEditorListSequence = ids[index];
    item.attrs!.semloEditorListRestart = false;
    item.content![0].content![0].text = names[index];
  });
  return json;
}

export function sequenceClipboardThreeLevelsContent(): JSONContent {
  const json = sequenceClipboardCrossParentContent();
  const list = json.content![0];
  list.attrs!.semloEditorListSequences.sequences.push({ id: "C", start: 1, origin: "initial" });
  const names = ["父甲", "子甲", "孙甲", "孙乙", "子乙", "父乙"];
  const levels = [0, 1, 2, 2, 1, 0];
  const ids = ["R", "A", "C", "C", "A", "R"];
  list.content!.forEach((item, index) => {
    item.attrs!.semloEditorListIndent = levels[index];
    item.attrs!.semloEditorListSequence = ids[index];
    item.content![0].content![0].text = names[index];
  });
  return json;
}

export function sequenceClipboardSelectedDeepContent(): JSONContent {
  const json = sequenceClipboardCrossParentContent();
  const list = json.content![0];
  list.attrs!.semloEditorListSequences.sequences.push({ id: "C", start: 1, origin: "initial" });
  const grandchild = structuredClone(list.content![1]);
  grandchild.attrs!.semloEditorListIndent = 2;
  grandchild.attrs!.semloEditorListSequence = "C";
  grandchild.content![0].content![0].text = "孙甲";
  list.content!.splice(2, 0, grandchild);
  return json;
}

export function sequenceClipboardOtherDeepContent(): JSONContent {
  const json = sequenceClipboardCrossParentContent();
  const list = json.content![0];
  list.attrs!.semloEditorListSequences.sequences.push({ id: "C", start: 1, origin: "initial" });
  const grandchild = structuredClone(list.content![5]);
  list.content![5].content!.push({ type: "paragraph", content: [{ type: "text", text: "子丁续段" }] });
  grandchild.attrs!.semloEditorListIndent = 2;
  grandchild.attrs!.semloEditorListSequence = "C";
  grandchild.content![0].content![0].text = "孙丁";
  list.content!.push(grandchild);
  return json;
}

export function sequenceClipboardOtherParentDeepContent(): JSONContent {
  const json = sequenceClipboardCrossParentContent();
  const list = json.content![0];
  list.attrs!.semloEditorListSequences.sequences.push(
    { id: "C", start: 1, origin: "initial" },
    { id: "D", start: 1, origin: "initial" },
  );
  const parent = structuredClone(list.content![0]);
  const child = structuredClone(list.content![1]);
  const grandchild = structuredClone(child);
  parent.content![0].content![0].text = "父丙";
  child.attrs!.semloEditorListSequence = "D";
  child.content![0].content![0].text = "子戊";
  child.content!.push({ type: "paragraph", content: [{ type: "text", text: "子戊续段" }] });
  grandchild.attrs!.semloEditorListIndent = 2;
  grandchild.attrs!.semloEditorListSequence = "C";
  grandchild.content![0].content![0].text = "孙戊";
  list.content!.push(parent, child, grandchild);
  return json;
}

export function sequenceClipboardLinkedFlatContent(): JSONContent {
  const list = (names: string[], start: number, link: string): JSONContent => ({
    type: "orderedList",
    attrs: {
      semloEditorOrderedStyle: "mixed",
      semloEditorListSequences: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
      semloEditorListSequenceLink: link,
    },
    content: names.map((text) => ({
      type: "listItem",
      attrs: { semloEditorListIndent: 0, semloEditorListSequence: "A" },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    })),
  });
  return {
    type: "doc",
    content: [
      list(["甲开头", "乙中段"], 1, "v1:_:edge"),
      { type: "paragraph", content: [{ type: "text", text: "中间" }] },
      list(["丙结尾", "丁后续"], 3, "v1:edge:_"),
      { type: "paragraph" },
    ],
  };
}
