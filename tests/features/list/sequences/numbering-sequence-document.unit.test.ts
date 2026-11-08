import { expect, test } from "@rstest/core";
import { getSchema, type JSONContent } from "@tiptap/core";
import { history, undo, redo } from "@tiptap/pm/history";
import { splitListItem } from "@tiptap/pm/schema-list";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { createCheckedJSONDocument } from "../../../../packages/core/src/editor/content/parse";
import { createStarterKitWithCodeFonts } from "../../../../packages/core/src/editor/starter-kit";
import { restartedDrag } from "../../../../packages/core/src/features/blocks/actions/restarted-drag";
import { ListFold } from "../../../../packages/core/src/features/list/list-fold";
import { numberingSequenceInput } from "../../../../packages/core/src/features/list/numbering-sequence-document";
import {
  assertNumberingSequenceDocument,
  resolveListNumbering,
  sequenceRegistryAttribute,
  sequenceMemberAttribute,
} from "../../../../packages/core/src/features/list/numbering-sequence-document";
import {
  numberingSequencePolicy,
  applySequencePlan,
} from "../../../../packages/core/src/features/list/numbering-sequence-transactions";
import { changeNumberingSequence } from "../../../../packages/core/src/features/list/numbering-sequences";
import { OrderedListNumbering } from "../../../../packages/core/src/features/list/ordered-numbering";
import { OrderedListStyles } from "../../../../packages/core/src/features/list/ordered-style";
import { ParagraphLayout } from "../../../../packages/core/src/features/text/paragraph-layout";

const schema = getSchema([
  createStarterKitWithCodeFonts([]),
  ParagraphLayout,
  OrderedListStyles,
  OrderedListNumbering,
  ListFold,
]);
const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });

function content(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: {
          [sequenceRegistryAttribute]: {
            version: 1,
            sequences: [
              { id: "R", start: 1, origin: "initial" },
              { id: "A", start: 1, origin: "initial" },
              { id: "B", start: 1, origin: "restart" },
            ],
          },
        },
        content: [
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 0, [sequenceMemberAttribute]: "R" },
            content: [paragraph("父")],
          },
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 1, [sequenceMemberAttribute]: "B" },
            content: [paragraph("乙")],
          },
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 1, [sequenceMemberAttribute]: "A" },
            content: [paragraph("甲")],
          },
          {
            type: "listItem",
            attrs: { semloEditorListIndent: 1, [sequenceMemberAttribute]: "B" },
            content: [paragraph("丙")],
          },
        ],
      },
    ],
  };
}

test("实际 schema 保留 registry 和局部成员，严格 JSON 关系不降级成旧编号", () => {
  const node = createCheckedJSONDocument(content(), schema);
  expect(node.firstChild?.attrs[sequenceRegistryAttribute]).toEqual(
    content().content?.[0].attrs?.[sequenceRegistryAttribute],
  );
  expect(resolveListNumbering(node.firstChild!).ok).toBe(true);
  const resolved = resolveListNumbering(node.firstChild!);
  if (!resolved.ok) throw new Error(resolved.reason);
  expect(resolved.value.values).toEqual([1, 1, 1, 2]);
  assertNumberingSequenceDocument(node);
});

test("严格 JSON 拒绝缺失的成员引用并保留输入", () => {
  const json = content();
  json.content![0].content![2].attrs![sequenceMemberAttribute] = "missing";
  const before = structuredClone(json);
  expect(() => createCheckedJSONDocument(json, schema)).toThrow("编号序列");
  expect(json).toEqual(before);
});

function state(json = content()) {
  return EditorState.create({
    doc: createCheckedJSONDocument(json, schema),
    plugins: [numberingSequencePolicy(), history()],
  });
}
function itemPos(current: EditorState, index: number): number {
  let pos = 1;
  for (let i = 0; i < index; i++) pos += current.doc.firstChild!.child(i).nodeSize;
  return pos;
}
function values(current: EditorState) {
  const resolved = resolveListNumbering(current.doc.firstChild!);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.value.values;
}
function legacy(five = false): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        content: ["父", "甲", "乙", "丙", ...(five ? ["丁", "戊"] : [])].map((text, index) => ({
          type: "listItem",
          attrs: {
            semloEditorListIndent: index === 0 ? 0 : 1,
            semloEditorListRestart: index === 2 || (five && index === 4),
          },
          content: [paragraph(text)],
        })),
      },
    ],
  };
}

for (const [five, source, target, before, texts, expected] of [
  [false, 2, 3, false, ["父", "甲", "丙", "乙"], [1, 1, 1, 2]],
  [false, 2, 1, true, ["父", "乙", "甲", "丙"], [1, 1, 1, 2]],
  [true, 1, 5, false, ["父", "乙", "丙", "丁", "戊", "甲"], [1, 1, 2, 1, 2, 1]],
  [true, 4, 1, true, ["父", "丁", "甲", "乙", "丙", "戊"], [1, 1, 1, 1, 2, 2]],
] as const)
  test(`真实事务原生向量 ${texts.join("")}`, () => {
    let current = state(legacy(five));
    const original = current.doc;
    const tr = restartedDrag(current, itemPos(current, source), itemPos(current, target), before);
    expect(tr).not.toBeNull();
    current = current.apply(tr!);
    expect(
      Array.from(
        { length: current.doc.firstChild!.childCount },
        (_, i) => current.doc.firstChild!.child(i).textContent,
      ),
    ).toEqual(texts);
    expect(values(current)).toEqual(expected);
    expect(current.selection.$from.parent.textContent).toBe(five && source === 4 ? "丁" : five ? "甲" : "乙");
    const moved = current.doc;
    expect(
      undo(current, (transaction) => {
        current = current.apply(transaction);
      }),
    ).toBe(true);
    expect(current.doc.eq(original)).toBe(true);
    expect(
      redo(current, (transaction) => {
        current = current.apply(transaction);
      }),
    ).toBe(true);
    expect(current.doc.eq(moved)).toBe(true);
  });

test("旧格式读取、正文和 marks 编辑不物化", () => {
  let current = state(legacy());
  current = current.apply(current.tr.insertText("改", itemPos(current, 2) + 3));
  current = current.apply(
    current.tr.addMark(itemPos(current, 2) + 2, itemPos(current, 2) + 3, schema.marks.bold.create()),
  );
  expect(current.doc.firstChild!.attrs[sequenceRegistryAttribute]).toBeNull();
  expect(current.doc.firstChild!.child(2).attrs[sequenceMemberAttribute]).toBeNull();
});

test("v1 正文、marks、段落行高和列表样式保留身份", () => {
  let current = state();
  const original = structuredClone(current.doc.firstChild!.attrs[sequenceRegistryAttribute]);
  const pos = itemPos(current, 2) + 2;
  current = current.apply(current.tr.insertText("改", pos));
  current = current.apply(current.tr.addMark(pos, pos + 1, schema.marks.bold.create()));
  const paragraphPos = itemPos(current, 2) + 1;
  current = current.apply(
    current.tr.setNodeMarkup(paragraphPos, undefined, {
      ...current.doc.nodeAt(paragraphPos)!.attrs,
      semloEditorLineHeight: "2",
    }),
  );
  current = current.apply(
    current.tr.setNodeMarkup(0, undefined, { ...current.doc.firstChild!.attrs, semloEditorOrderedStyle: "decimal" }),
  );
  expect(current.doc.firstChild!.attrs[sequenceRegistryAttribute]).toEqual(original);
  expect(values(current)).toEqual([1, 1, 1, 2]);
  expect(current.doc.firstChild!.child(2).firstChild!.textContent).toBe("改甲");
});

test("同组 Enter 真实 split 事务保留身份并独立计数", () => {
  let current = state();
  const pos = itemPos(current, 1) + 3;
  current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, pos)));
  const attrs = { ...current.doc.firstChild!.child(1).attrs, semloEditorListRestart: false };
  expect(
    splitListItem(schema.nodes.listItem, attrs)(current, (tr) => {
      current = current.apply(tr);
    }),
  ).toBe(true);
  expect(current.doc.firstChild!.childCount).toBe(5);
  expect(values(current)).toEqual([1, 1, 2, 1, 3]);
  expect(current.doc.firstChild!.child(2).attrs[sequenceMemberAttribute]).toBe("B");
});

test("删除叶成员保留后续同组关系，删除有子项的父成员被拒绝", () => {
  let current = state();
  const before = current.doc;
  const parentDelete = current.tr.delete(itemPos(current, 0), itemPos(current, 1));
  current = current.apply(parentDelete);
  expect(current.doc.eq(before)).toBe(true);
  const from = itemPos(current, 1),
    to = itemPos(current, 2);
  current = current.apply(current.tr.delete(from, to));
  expect(values(current)).toEqual([1, 1, 1]);
  expect(current.doc.firstChild!.child(2).attrs[sequenceMemberAttribute]).toBe("B");
});

test("未经序列入口的 registry、成员身份与层级修改被拒绝", () => {
  const current = state();
  for (const attrs of [
    { ...current.doc.firstChild!.child(1).attrs, [sequenceMemberAttribute]: "A" },
    { ...current.doc.firstChild!.child(1).attrs, semloEditorListIndent: 0 },
    { ...current.doc.firstChild!.child(1).attrs, [sequenceMemberAttribute]: null },
  ])
    expect(current.apply(current.tr.setNodeMarkup(itemPos(current, 1), undefined, attrs)).doc.eq(current.doc)).toBe(
      true,
    );
  expect(
    current
      .apply(
        current.tr.setNodeMarkup(0, undefined, { ...current.doc.firstChild!.attrs, [sequenceRegistryAttribute]: null }),
      )
      .doc.eq(current.doc),
  ).toBe(true);
});

test("直接标题转换与引用包裹不能丢失成员或改变父层", () => {
  const current = state();
  const pos = itemPos(current, 1) + 1;
  expect(() => current.tr.setNodeMarkup(pos, schema.nodes.heading, { level: 2 })).toThrow(
    "Invalid content for node listItem",
  );
  const wrapped = schema.nodes.blockquote.create(null, current.doc.firstChild!);
  expect(current.apply(current.tr.replaceWith(0, current.doc.content.size, wrapped)).doc.eq(current.doc)).toBe(true);
});

test("显式 restart/continue 在同一真实事务更新 registry，历史恢复来源与引用", () => {
  let current = state();
  const before = current.doc;
  const plan = changeNumberingSequence(numberingSequenceInput(current.doc.firstChild!), { kind: "continue", index: 1 });
  if (!plan.ok) throw new Error(plan.reason);
  current = current.apply(applySequencePlan(current.tr, 0, plan.value));
  expect(values(current)).toEqual([1, 1, 2, 3]);
  expect(current.doc.firstChild!.child(1).attrs[sequenceMemberAttribute]).toBe("A");
  expect(
    undo(current, (tr) => {
      current = current.apply(tr);
    }),
  ).toBe(true);
  expect(current.doc.eq(before)).toBe(true);
});

test("无效外部替换即使携带受控标记也不能进入文档", () => {
  const current = state();
  const invalid = schema.nodes.orderedList.create(
    { ...current.doc.firstChild!.attrs, [sequenceRegistryAttribute]: { version: 2, sequences: [] } },
    current.doc.firstChild!.content,
  );
  expect(
    current
      .apply(current.tr.replaceWith(0, current.doc.content.size, invalid).setMeta("preventUpdate", true))
      .doc.eq(current.doc),
  ).toBe(true);
});

test("跨父、跨层与带子项拖动保持拒绝", () => {
  const current = state(legacy(true));
  expect(restartedDrag(current, itemPos(current, 0), itemPos(current, 2), false)).toBeNull();
  const json = legacy();
  json.content![0].content!.push({ type: "listItem", content: [paragraph("另父")] });
  json.content![0].content!.push({
    type: "listItem",
    attrs: { semloEditorListIndent: 1 },
    content: [paragraph("另子")],
  });
  const other = state(json);
  expect(restartedDrag(other, itemPos(other, 2), itemPos(other, 5), false)).toBeNull();
});

for (const text of ["", "写作新增正文"])
  test(`同级插入${text ? "完整写作正文" : "空项后输入"}保留局部ID`, () => {
    let current = state();
    const source = current.doc.firstChild!.child(1);
    const attrs = { ...source.attrs, semloEditorListRestart: false };
    const paragraph = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
    const sibling = source.type.create(attrs, paragraph);
    current = current.apply(current.tr.insert(itemPos(current, 2), sibling));
    expect(current.doc.firstChild!.childCount).toBe(5);
    expect(values(current)).toEqual([1, 1, 2, 1, 3]);
    if (!text) current = current.apply(current.tr.insertText("新", itemPos(current, 2) + 2));
    expect(current.doc.firstChild!.child(2).firstChild!.textContent).toBe(text || "新");
    expect(current.doc.firstChild!.child(2).attrs[sequenceMemberAttribute]).toBe("B");
  });

test("v1 父项折叠属于展示编辑，保留序列及编号", () => {
  const current = state();
  const parent = current.doc.firstChild!.firstChild!;
  const folded = current.apply(
    current.tr.setNodeMarkup(1, undefined, { ...parent.attrs, semloEditorListFolded: true }),
  );
  expect(folded.doc.firstChild!.firstChild!.attrs.semloEditorListFolded).toBe(true);
  expect(folded.doc.firstChild!.attrs[sequenceRegistryAttribute]).toEqual(
    current.doc.firstChild!.attrs[sequenceRegistryAttribute],
  );
  expect(values(folded)).toEqual(values(current));
});

test("几何目标守卫独立于最终插入序号：跨层边界和带子项目标仍拒绝", () => {
  const json = legacy();
  json.content![0].content!.push({ type: "listItem", content: [paragraph("另父")] });
  json.content![0].content!.push({
    type: "listItem",
    attrs: { semloEditorListIndent: 1 },
    content: [paragraph("另子")],
  });
  const crossLevel = state(json);
  expect(Boolean(restartedDrag(crossLevel, itemPos(crossLevel, 2), itemPos(crossLevel, 4), true))).toBe(false);
  const group = legacy();
  group.content![0].content!.push({
    type: "listItem",
    attrs: { semloEditorListIndent: 2 },
    content: [paragraph("丙子")],
  });
  const nested = state(group);
  expect(Boolean(restartedDrag(nested, itemPos(nested, 1), itemPos(nested, 3), true))).toBe(false);
});

test("共享不可变 Node 引用的两个物理列表仍不能跨列表重排", () => {
  const list = state(legacy()).doc.firstChild!;
  const doc = schema.topNodeType.create(null, [list, list]);
  const current = EditorState.create({ doc, plugins: [numberingSequencePolicy()] });
  const source = itemPos(current, 2),
    target = list.nodeSize + itemPos(current, 1);
  expect(current.doc.resolve(source).parent).toBe(current.doc.resolve(target).parent);
  expect(Boolean(restartedDrag(current, source, target, true))).toBe(false);
});

test("共享 Node 位于不同嵌套深度时双向拒绝且不越界", () => {
  const list = state(legacy()).doc.firstChild!;
  const doc = schema.topNodeType.create(null, [list, schema.nodes.blockquote.create(null, list)]);
  const current = EditorState.create({ doc, plugins: [numberingSequencePolicy()] });
  const root = itemPos(current, 2),
    nested = list.nodeSize + 1 + itemPos(current, 1);
  expect(current.doc.resolve(root).parent).toBe(current.doc.resolve(nested).parent);
  expect(current.doc.resolve(root).depth).toBe(1);
  expect(current.doc.resolve(nested).depth).toBe(2);
  for (const [source, target] of [
    [root, nested],
    [nested, root],
  ]) {
    expect(() => restartedDrag(current, source, target, true)).not.toThrow();
    expect(Boolean(restartedDrag(current, source, target, true))).toBe(false);
  }
});
