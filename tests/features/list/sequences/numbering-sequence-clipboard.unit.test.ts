import { expect, test } from "@rstest/core";
import { getSchema } from "@tiptap/core";
import { history, undo, redo } from "@tiptap/pm/history";
import { EditorState, TextSelection, NodeSelection, AllSelection } from "@tiptap/pm/state";

import { createCheckedJSONDocument } from "../../../../packages/core/src/editor/content/parse";
import { createStarterKitWithCodeFonts } from "../../../../packages/core/src/editor/starter-kit";
import { HeadingNumbering } from "../../../../packages/core/src/features/heading/numbering";
import { ListFold } from "../../../../packages/core/src/features/list/list-fold";
import {
  projectNumberingSequenceClipboard,
  projectNumberingSequenceMixedCopy,
  projectNumberingSequenceMixedCut,
  projectNumberingSequenceRootCopy,
} from "../../../../packages/core/src/features/list/numbering-sequence-clipboard";
import { resolveListNumbering } from "../../../../packages/core/src/features/list/numbering-sequence-document";
import {
  markSequenceOperation,
  numberingSequencePolicy,
} from "../../../../packages/core/src/features/list/numbering-sequence-transactions";
import { OrderedListNumbering } from "../../../../packages/core/src/features/list/ordered-numbering";
import { OrderedListStyles } from "../../../../packages/core/src/features/list/ordered-style";
import { ParagraphLayout } from "../../../../packages/core/src/features/text/paragraph-layout";
import {
  sequenceClipboardContent,
  sequenceClipboardBoundaryContent,
  sequenceClipboardCrossParentContent,
  sequenceClipboardThreeLevelsContent,
  sequenceClipboardSelectedDeepContent,
  sequenceClipboardOtherDeepContent,
  sequenceClipboardOtherParentDeepContent,
  sequenceClipboardLinkedFlatContent,
} from "../../../fixtures/list/sequences/numbering-sequence-clipboard-content";

const schema = getSchema([
  createStarterKitWithCodeFonts([]),
  ParagraphLayout,
  OrderedListStyles,
  OrderedListNumbering,
  ListFold,
  HeadingNumbering,
]);
function state(same = false, five = false) {
  return EditorState.create({
    doc: createCheckedJSONDocument(sequenceClipboardContent(same, five), schema),
    plugins: [numberingSequencePolicy(), history()],
  });
}
function select(current: EditorState, first = "甲开头", last = "丙结尾", a = 1, b = 1) {
  let from = -1,
    to = -1;
  current.doc.descendants((node, pos) => {
    if (["paragraph", "heading"].includes(node.type.name) && node.textContent === first) from = pos + 1 + a;
    if (["paragraph", "heading"].includes(node.type.name) && node.textContent === last) to = pos + 1 + b;
  });
  return current.apply(current.tr.setSelection(TextSelection.create(current.doc, from, to)));
}
function values(current: EditorState) {
  const result = resolveListNumbering(current.doc.firstChild!);
  if (!result.ok) throw new Error(result.reason);
  return result.value.values;
}

for (const same of [false, true])
  test(`${same ? "同" : "跨"}序列投影closed且从1，源plain保留权威数值/marks/行高/level`, () => {
    const current = select(state(same));
    const before = current.doc;
    const plan = projectNumberingSequenceClipboard(current)!;
    expect(plan).not.toBeNull();
    expect(plan.slice.openStart).toBe(0);
    expect(plan.slice.openEnd).toBe(0);
    expect(plan.text).toBe(same ? "  a. 开头\n  b. 乙中段\n  c. 丙" : "  a. 开头\n  a. 乙中段\n  b. 丙");
    const list = plan.slice.content.firstChild!;
    expect(list.attrs.semloEditorListSequences).toBeNull();
    expect(list.attrs.start).toBe(1);
    list.forEach((item) => {
      expect(item.attrs.semloEditorListSequence).toBeNull();
      expect(item.attrs.semloEditorListRestart).toBe(false);
      expect(item.attrs.semloEditorListIndent).toBe(1);
      expect(item.firstChild!.attrs.semloEditorLineHeight).toBe("2");
    });
    const result = resolveListNumbering(list);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.values).toEqual([1, 2, 3]);
    expect(list.firstChild!.firstChild!.firstChild!.marks[0].type.name).toBe("bold");
    expect(list.child(1).firstChild!.firstChild!.marks[0].type.name).toBe("italic");
    expect(current.doc).toBe(before);
  });

test("从源b/c复制仍生成起点1，源文档和历史不变", () => {
  const current = select(state(true), "乙中段", "丙结尾");
  const plan = projectNumberingSequenceClipboard(current)!;
  expect(plan.text).toBe("  b. 中段\n  c. 丙");
  expect(plan.slice.content.firstChild!.attrs.start).toBe(1);
  expect(current.doc.firstChild!.childCount).toBe(4);
});

for (const same of [false, true])
  test(`${same ? "同" : "跨"}序列cut合首prefix与末suffix，单步历史精确恢复registry/origin`, () => {
    let current = select(state(same, true));
    const before = current.doc;
    const plan = projectNumberingSequenceClipboard(current)!;
    expect(plan.cut).not.toBeNull();
    current = current.apply(markSequenceOperation(plan.cut!));
    expect(current.doc.firstChild!.childCount).toBe(4);
    expect(current.doc.firstChild!.child(1).textContent).toBe("甲结尾");
    expect(current.doc.firstChild!.child(1).attrs.semloEditorListSequence).toBe("A");
    expect(current.doc.firstChild!.child(2)).toBe(before.firstChild!.child(4));
    expect(current.doc.firstChild!.attrs.semloEditorListSequences).toEqual(
      before.firstChild!.attrs.semloEditorListSequences,
    );
    expect(values(current)).toEqual(same ? [1, 1, 2, 3] : [1, 1, 1, 2]);
    const after = current.doc;
    expect(
      undo(current, (tr) => {
        current = current.apply(tr);
      }),
    ).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
    expect(
      redo(current, (tr) => {
        current = current.apply(tr);
      }),
    ).toBe(true);
    expect(current.doc.eq(after)).toBe(true);
  });

for (const a of [0, 1, 3])
  for (const b of [0, 1, 3])
    test(`端点组合 ${a}/${b} 保首项与空段、范围外成员和精确历史`, () => {
      let current = select(
        EditorState.create({
          doc: createCheckedJSONDocument(sequenceClipboardBoundaryContent(), schema),
          plugins: [numberingSequencePolicy(), history()],
        }),
        "甲开头",
        "丙结尾",
        a,
        b,
      );
      const before = current.doc,
        plan = projectNumberingSequenceClipboard(current)!;
      expect(plan).not.toBeNull();
      expect(plan.cut).not.toBeNull();
      expect(plan.text).toBe(`  a. ${"甲开头".slice(a)}\n  a. 乙中段\n  b. ${"丙结尾".slice(0, b)}`);
      expect(plan.slice.content.firstChild!.childCount).toBe(3);
      expect(plan.slice.content.firstChild!.firstChild!.firstChild!.textContent).toBe("甲开头".slice(a));
      expect(plan.slice.content.firstChild!.lastChild!.firstChild!.textContent).toBe("丙结尾".slice(0, b));
      current = current.apply(markSequenceOperation(plan.cut));
      expect(current.doc.firstChild!.childCount).toBe(3);
      expect(current.doc.firstChild!.child(1).textContent).toBe("甲开头".slice(0, a) + "丙结尾".slice(b));
      expect(current.doc.firstChild!.child(1).attrs).toEqual(before.firstChild!.child(1).attrs);
      expect(current.doc.firstChild!.child(1).firstChild!.attrs).toEqual(before.firstChild!.child(1).firstChild!.attrs);
      expect(current.doc.firstChild!.firstChild).toBe(before.firstChild!.firstChild);
      expect(current.doc.firstChild!.lastChild).toBe(before.firstChild!.lastChild);
      expect(current.doc.firstChild!.attrs.semloEditorListSequences).toEqual(
        before.firstChild!.attrs.semloEditorListSequences,
      );
      expect(values(current)).toEqual([1, 1, 1]);
      const after = current.doc;
      expect(
        undo(current, (tr) => {
          current = current.apply(tr);
        }),
      ).toBe(true);
      expect(current.doc.eq(before)).toBe(true);
      expect(
        redo(current, (tr) => {
          current = current.apply(tr);
        }),
      ).toBe(true);
      expect(current.doc.eq(after)).toBe(true);
    });

test("空选区、单段、NodeSelection及整文档交还原路径", () => {
  const current = state();
  expect(projectNumberingSequenceClipboard(current)).toBeNull();
  expect(projectNumberingSequenceClipboard(select(current, "甲开头", "甲开头", 1, 2))).toBeNull();
  expect(
    projectNumberingSequenceClipboard(current.apply(current.tr.setSelection(NodeSelection.create(current.doc, 0)))),
  ).toBeNull();
  expect(
    projectNumberingSequenceClipboard(current.apply(current.tr.setSelection(new AllSelection(current.doc)))),
  ).toBeNull();
});

test("旧格式不投影/不物化", () => {
  const json = sequenceClipboardContent();
  const list = json.content![0];
  delete list.attrs!.semloEditorListSequences;
  list.content!.forEach((item) => {
    delete item.attrs!.semloEditorListSequence;
  });
  const current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }));
  expect(projectNumberingSequenceClipboard(current)).toBeNull();
  expect(current.doc.firstChild!.attrs.semloEditorListSequences).toBeNull();
});

test("跨层和带子项范围继续拒绝", () => {
  const current = state();
  expect(projectNumberingSequenceClipboard(select(current, "父", "丙结尾", 0, 1))).toBeNull();
  const list = current.doc.firstChild!;
  const changed = list
    .child(2)
    .type.create({ ...list.child(2).attrs, semloEditorListIndent: 2 }, list.child(2).content);
  const doc = schema.topNodeType.create(
    null,
    list.type.create(list.attrs, [list.child(0), list.child(1), changed, list.child(3)]),
  );
  const invalid = select(EditorState.create({ doc }));
  expect(projectNumberingSequenceClipboard(invalid)).toBeNull();
  expect(projectNumberingSequenceMixedCopy(invalid)).toBeNull();
  expect(projectNumberingSequenceMixedCut(invalid)).toBeNull();
});

test("跨父子和跨父项复制保留可见层级与源编号，片段独立重编号", () => {
  const current = EditorState.create({
    doc: createCheckedJSONDocument(sequenceClipboardCrossParentContent(), schema),
    plugins: [numberingSequencePolicy(), history()],
  });
  for (const sample of [
    {
      first: "父甲",
      last: "子乙",
      text: "1. 甲\n  a. 子甲\n  b. 子",
      levels: [0, 1, 1],
      values: [1, 1, 2],
      cutWords: ["父乙", "父乙", "子丙", "子丁"],
      cutValues: [1, 2, 1, 2],
    },
    {
      first: "子甲",
      last: "子丙",
      text: "  a. 甲\n  b. 子乙\n2. 父乙\n  a. 子",
      levels: [1, 1, 0, 1],
      values: [1, 2, 1, 1],
      cutWords: ["父甲", "子丙", "子丁"],
      cutValues: [1, 1, 2],
    },
  ]) {
    const selected = select(current, sample.first, sample.last, 1, 1);
    const plan = projectNumberingSequenceMixedCopy(selected)!;
    expect(plan.text).toBe(sample.text);
    const projected = plan.slice.content.firstChild!;
    expect(projected.attrs.semloEditorListSequences).toBeNull();
    const levels: number[] = [];
    projected.forEach((item) => {
      levels.push(item.attrs.semloEditorListIndent);
      expect(item.attrs.semloEditorListSequence).toBeNull();
    });
    expect(levels).toEqual(sample.levels);
    const resolved = resolveListNumbering(projected);
    expect(resolved.ok && resolved.value.values).toEqual(sample.values);
    expect(selected.doc).toBe(current.doc);
    expect(projectNumberingSequenceClipboard(selected)).toBeNull();
    const cut = projectNumberingSequenceMixedCut(selected)!;
    expect(cut.text).toBe(sample.text);
    const after = selected.apply(markSequenceOperation(cut.cut));
    const remaining: string[] = [];
    after.doc.firstChild!.forEach((item) => remaining.push(item.textContent));
    expect(remaining).toEqual(sample.cutWords);
    expect(values(after)).toEqual(sample.cutValues);
  }
});

test("从根项到三级子项复制和剪切，保留未选直接子项", () => {
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(sequenceClipboardThreeLevelsContent(), schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "父甲",
    "孙乙",
    1,
    1,
  );
  const before = current.doc;
  const copied = projectNumberingSequenceMixedCopy(current)!;
  expect(copied.text).toBe("1. 甲\n  a. 子甲\n    ⅰ. 孙甲\n    ⅱ. 孙");
  const projected = copied.slice.content.firstChild!;
  const levels: number[] = [];
  projected.forEach((item) => {
    levels.push(item.attrs.semloEditorListIndent);
    expect(item.attrs.semloEditorListSequence).toBeNull();
  });
  expect(levels).toEqual([0, 1, 2, 2]);
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe(copied.text);
  const after = current.apply(markSequenceOperation(cut.cut));
  expect(after.doc.firstChild!.childCount).toBe(3);
  expect(after.doc.firstChild!.child(0).textContent).toBe("父乙");
  expect(after.doc.firstChild!.child(1)).toBe(before.firstChild!.child(4));
  expect(after.doc.firstChild!.child(2)).toBe(before.firstChild!.child(5));
  expect(values(after)).toEqual([1, 1, 2]);
  let restored = after;
  expect(undo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(redo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
  const protectedRange = select(current, "父甲", "孙甲", 1, 1);
  expect(projectNumberingSequenceMixedCut(protectedRange)).toBeNull();
});

test("跨父子剪切完整选中的三级子树，保留未选后继并一次撤销", () => {
  const content = sequenceClipboardThreeLevelsContent();
  const list = content.content![0].content!;
  const later = structuredClone(list[4]);
  later.content![0].content![0].text = "子后";
  list.splice(5, 0, later);
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(content, schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "父甲",
    "子乙",
    1,
    1,
  );
  const before = current.doc;
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe("1. 甲\n  a. 子甲\n    ⅰ. 孙甲\n    ⅱ. 孙乙\n  b. 子");
  const after = current.apply(markSequenceOperation(cut.cut));
  expect(after.doc.firstChild!.childCount).toBe(3);
  expect(after.doc.firstChild!.child(0).textContent).toBe("父乙");
  expect(after.doc.firstChild!.child(1)).toBe(before.firstChild!.child(5));
  expect(after.doc.firstChild!.child(2)).toBe(before.firstChild!.child(6));
  expect(values(after)).toEqual([1, 1, 2]);
  let restored = after;
  expect(undo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(redo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
});

test("跨父子剪切不受其他分支的三级项阻碍，但末项后代仍受保护", () => {
  const content = sequenceClipboardOtherDeepContent();
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(content, schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "父甲",
    "子乙",
    1,
    1,
  );
  const before = current.doc;
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe("1. 甲\n  a. 子甲\n  b. 子");
  const after = current.apply(markSequenceOperation(cut.cut));
  expect(after.doc.firstChild!.childCount).toBe(5);
  expect(after.doc.firstChild!.child(0).textContent).toBe("父乙");
  expect(after.doc.firstChild!.child(3)).toBe(before.firstChild!.child(5));
  expect(after.doc.firstChild!.child(4)).toBe(before.firstChild!.child(6));
  expect(values(after)).toEqual([1, 2, 1, 2, 1]);
  let restored = after;
  expect(
    undo(restored, (tr) => {
      restored = restored.apply(tr);
    }),
  ).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(
    redo(restored, (tr) => {
      restored = restored.apply(tr);
    }),
  ).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
  const protectedRange = select(
    EditorState.create({ doc: createCheckedJSONDocument(sequenceClipboardThreeLevelsContent(), schema) }),
    "父甲",
    "子甲",
    1,
    1,
  );
  expect(projectNumberingSequenceMixedCut(protectedRange)).toBeNull();
});

test("跨父项剪切保留无关父项的多段与深层子树", () => {
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(sequenceClipboardOtherParentDeepContent(), schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "子甲",
    "子丙",
    1,
    1,
  );
  const before = current.doc;
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe("  a. 甲\n  b. 子乙\n2. 父乙\n  a. 子");
  const after = current.apply(markSequenceOperation(cut.cut));
  expect(after.doc.firstChild!.childCount).toBe(6);
  expect(values(after)).toEqual([1, 1, 2, 2, 1, 1]);
  for (let index = 0; index < 3; index++)
    expect(after.doc.firstChild!.child(index + 3)).toBe(before.firstChild!.child(index + 6));
  let restored = after;
  expect(undo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(redo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
  const unsafe = select(
    EditorState.create({ doc: createCheckedJSONDocument(sequenceClipboardOtherDeepContent(), schema) }),
    "子甲",
    "子丙",
    1,
    1,
  );
  expect(projectNumberingSequenceMixedCut(unsafe)).toBeNull();
});

test("跨父项剪切完整选中的深层子树并保留末父项未选子项", () => {
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(sequenceClipboardSelectedDeepContent(), schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "子甲",
    "子丙",
    1,
    1,
  );
  const before = current.doc;
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe("  a. 甲\n    ⅰ. 孙甲\n  b. 子乙\n2. 父乙\n  a. 子");
  const after = current.apply(markSequenceOperation(cut.cut));
  expect(after.doc.firstChild!.childCount).toBe(3);
  expect(after.doc.firstChild!.child(0)).toBe(before.firstChild!.child(0));
  expect(after.doc.firstChild!.child(1).textContent).toBe("子丙");
  expect(after.doc.firstChild!.child(2).textContent).toBe("子丁");
  expect(after.doc.firstChild!.child(2).attrs.semloEditorListSequence).toBe("A");
  expect(values(after)).toEqual([1, 1, 2]);
  let restored = after;
  expect(undo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(redo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
});

test("同父同级剪切完整选中的深层子树，末项后代仍受保护", () => {
  const current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(sequenceClipboardSelectedDeepContent(), schema),
      plugins: [numberingSequencePolicy(), history()],
    }),
    "子甲",
    "子乙",
    1,
    1,
  );
  const before = current.doc;
  const cut = projectNumberingSequenceMixedCut(current)!;
  expect(cut.text).toBe("  a. 甲\n    ⅰ. 孙甲\n  b. 子");
  const after = current.apply(markSequenceOperation(cut.cut));
  const remaining: string[] = [];
  after.doc.firstChild!.forEach((item) => remaining.push(item.textContent));
  expect(remaining).toEqual(["父甲", "子乙", "父乙", "子丙", "子丁"]);
  expect(values(after)).toEqual([1, 1, 2, 1, 2]);
  let restored = after;
  expect(undo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(before)).toBe(true);
  expect(redo(restored, (tr) => (restored = restored.apply(tr)))).toBe(true);
  expect(restored.doc.eq(after.doc)).toBe(true);
  const protectedContent = sequenceClipboardSelectedDeepContent();
  const list = protectedContent.content![0];
  const grandchild = structuredClone(list.content![2]);
  grandchild.attrs!.semloEditorListSequence = "D";
  grandchild.content![0].content![0].text = "孙乙";
  list.content!.splice(4, 0, grandchild);
  list.attrs!.semloEditorListSequences.sequences.push({ id: "D", start: 1, origin: "initial" });
  const protectedRange = select(
    EditorState.create({ doc: createCheckedJSONDocument(protectedContent, schema) }),
    "子甲",
    "子乙",
    1,
    1,
  );
  expect(projectNumberingSequenceMixedCut(protectedRange)).toBeNull();
});

test("跨编号列表和正文复制保留两类块并独立编号", () => {
  const current = select(state(), "甲开头", "footer", 1, 3);
  const before = current.doc;
  const copied = projectNumberingSequenceRootCopy(current)!;
  expect(copied.text).toBe("  a. 开头\n  a. 乙中段\n  b. 丙结尾\n\nfoo");
  expect(copied.root.childCount).toBe(2);
  expect(copied.root.child(0).type.name).toBe("orderedList");
  expect(copied.root.child(1).textContent).toBe("foo");
  expect(copied.root.child(0).attrs.semloEditorListSequences).toBeNull();
  expect(copied.root.child(0).firstChild!.firstChild!.firstChild!.marks[0].type.name).toBe("bold");
  expect(current.doc).toBe(before);
});

test("跨两个独立编号列表复制保留各块与源编号", () => {
  const json = sequenceClipboardContent();
  json.content = [json.content![0], json.content![1], sequenceClipboardCrossParentContent().content![0]];
  const current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }), "甲开头", "子乙", 1, 1);
  const copied = projectNumberingSequenceRootCopy(current)!;
  expect(copied.text).toBe("  a. 开头\n  a. 乙中段\n  b. 丙结尾\n\nfooter\n\n1. 父甲\n  a. 子甲\n  b. 子");
  expect(copied.root.childCount).toBe(3);
  expect(copied.root.child(0).attrs.semloEditorListSequences).toBeNull();
  expect(copied.root.child(2).attrs.semloEditorListSequences).toBeNull();
});

test("跨复杂关联编号列表的复制仍保持保护", () => {
  const json = sequenceClipboardContent();
  const second = sequenceClipboardCrossParentContent().content![0];
  json.content![0].attrs!.semloEditorListSequenceLink = "v1:_:edge";
  second.attrs!.semloEditorListSequenceLink = "v1:edge:_";
  json.content = [json.content![0], json.content![1], second];
  const current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }), "甲开头", "子乙", 1, 1);
  expect(projectNumberingSequenceRootCopy(current)).toBeNull();
});

test("跨同序列平级续接列表的部分复制重新关联并从一开始", () => {
  const current = select(
    EditorState.create({ doc: createCheckedJSONDocument(sequenceClipboardLinkedFlatContent(), schema) }),
    "甲开头",
    "丁后续",
    1,
    1,
  );
  const before = current.doc;
  const copied = projectNumberingSequenceRootCopy(current)!;
  expect(copied.text).toBe("1. 开头\n2. 乙中段\n\n中间\n\n3. 丙结尾\n4. 丁");
  const first = copied.root.child(0),
    second = copied.root.child(2);
  expect(first.attrs.semloEditorListSequenceLink).toMatch(/^v1:_:/);
  expect(second.attrs.semloEditorListSequenceLink).toBe(
    first.attrs.semloEditorListSequenceLink.replace("v1:_:", "v1:") + ":_",
  );
  expect(first.attrs.semloEditorListSequenceLink).not.toContain("edge");
  const left = resolveListNumbering(first),
    right = resolveListNumbering(second);
  expect(left.ok && left.value.values).toEqual([1, 2]);
  expect(right.ok && right.value.values).toEqual([3, 4]);
  expect(current.doc).toBe(before);
});

for (const version of [2, 3] as const)
  test(`v${version} 续接的部分复制保留版本及两侧编号`, () => {
    const json = sequenceClipboardLinkedFlatContent();
    json.content![0].attrs!.semloEditorListSequenceLink = `v${version}:_:edge`;
    json.content![2].attrs!.semloEditorListSequenceLink = `v${version}:edge:_`;
    if (version === 3)
      json.content![1] = { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "中间" }] };
    const current = select(
      EditorState.create({ doc: createCheckedJSONDocument(json, schema) }),
      "甲开头",
      "丁后续",
      1,
      1,
    );
    const copied = projectNumberingSequenceRootCopy(current)!;
    const first = copied.root.child(0),
      second = copied.root.child(2);
    expect(first.attrs.semloEditorListSequenceLink).toMatch(new RegExp(`^v${version}:_:`));
    expect(second.attrs.semloEditorListSequenceLink).toBe(
      first.attrs.semloEditorListSequenceLink.replace(`v${version}:_:`, `v${version}:`) + ":_",
    );
    expect(first.attrs.semloEditorListSequenceLink).not.toContain("edge");
    const left = resolveListNumbering(first),
      right = resolveListNumbering(second);
    expect(left.ok && left.value.values).toEqual([1, 2]);
    expect(right.ok && right.value.values).toEqual([3, 4]);
    expect(copied.root.child(1).type.name).toBe(version === 3 ? "heading" : "paragraph");
  });

test("跨 v3 编号标题的完整选区复制保留源标题编号与独立续接", () => {
  const json = sequenceClipboardLinkedFlatContent();
  json.content![0].attrs!.semloEditorListSequenceLink = "v3:_:edge";
  json.content![1] = {
    type: "heading",
    attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
    content: [{ type: "text", text: "中间" }],
  };
  json.content![2].attrs!.semloEditorListSequenceLink = "v3:edge:_";
  const current = select(
    EditorState.create({ doc: createCheckedJSONDocument(json, schema) }),
    "甲开头",
    "丁后续",
    1,
    1,
  );
  const copied = projectNumberingSequenceRootCopy(current)!;
  expect(copied.headings).toEqual([{ level: 3, text: "中间", style: "mixed", marker: "1." }]);
  expect(copied.text).toBe("1. 开头\n2. 乙中段\n\n中间\n\n3. 丙结尾\n4. 丁");
  expect(copied.root.child(0).attrs.semloEditorListSequenceLink).toMatch(/^v3:_:/);
  expect(copied.root.child(2).attrs.semloEditorListSequenceLink).toMatch(/^v3:.*:_$/);
});

test("跨编号列表与普通标题可复制，编号标题仍受保护", () => {
  const json = sequenceClipboardContent();
  json.content![1] = { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "小标题" }] };
  let current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }), "甲开头", "小标题", 1, 2);
  const copied = projectNumberingSequenceRootCopy(current)!;
  expect(copied.root.child(1).type.name).toBe("heading");
  expect(copied.root.child(1).attrs.level).toBe(2);
  expect(copied.root.child(1).textContent).toBe("小标");
  json.content![1].attrs!.semloEditorHeadingNumbering = "mixed";
  current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }), "甲开头", "小标题", 1, 2);
  expect(projectNumberingSequenceRootCopy(current)).toBeNull();
});

test("共享Node的不同物理列表不能跨界；不同嵌套depth拒绝不抛错", () => {
  const list = state().doc.firstChild!;
  for (const nested of [false, true]) {
    const doc = schema.topNodeType.create(null, [list, nested ? schema.nodes.blockquote.create(null, list) : list]);
    let from = -1,
      to = -1;
    doc.descendants((node, pos) => {
      if (node.type.name !== "paragraph") return;
      if (node.textContent === "甲开头" && from < 0) from = pos + 2;
      if (node.textContent === "丙结尾") to = pos + 2;
    });
    const current = EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
    expect(() => projectNumberingSequenceClipboard(current)).not.toThrow();
    expect(projectNumberingSequenceClipboard(current)).toBeNull();
    expect(projectNumberingSequenceMixedCopy(current)).toBeNull();
    expect(projectNumberingSequenceMixedCut(current)).toBeNull();
  }
});

test("无效registry关系拒绝，不重建成普通源列表", () => {
  const current = select(state());
  const list = current.doc.firstChild!;
  const invalid = list.type.create(
    { ...list.attrs, semloEditorListSequences: { version: 2, sequences: [] } },
    list.content,
  );
  const doc = schema.topNodeType.create(null, invalid);
  const selected = EditorState.create({
    doc,
    selection: TextSelection.create(doc, current.selection.from, current.selection.to),
  });
  expect(projectNumberingSequenceClipboard(selected)).toBeNull();
});

test("交错序列保留范围外成员与origin，计数仅减少被删成员", () => {
  const json = sequenceClipboardContent(false, true);
  json.content![0].content![3].attrs!.semloEditorListSequence = "A";
  json.content![0].content![5].attrs!.semloEditorListSequence = "B";
  let current = select(
    EditorState.create({ doc: createCheckedJSONDocument(json, schema), plugins: [numberingSequencePolicy()] }),
  );
  const registry = structuredClone(current.doc.firstChild!.attrs.semloEditorListSequences);
  const plan = projectNumberingSequenceClipboard(current)!;
  current = current.apply(markSequenceOperation(plan.cut!));
  expect(values(current)).toEqual([1, 1, 1, 1]);
  expect(current.doc.firstChild!.child(3).attrs.semloEditorListSequence).toBe("B");
  expect(current.doc.firstChild!.attrs.semloEditorListSequences).toEqual(registry);
});

test("alpha跨z及旧seed不成为新片段计数权威，自定义样式继续复用可见投影", () => {
  const json = sequenceClipboardContent(true);
  json.content![0].attrs!.semloEditorListSequences.sequences[1].start = 26;
  json.content![0].attrs!.start = 99;
  json.content![0].attrs!.semloEditorListLevelStarts = { "1": 77 };
  const current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }));
  const plan = projectNumberingSequenceClipboard(current)!;
  expect(plan.text).toBe("  z. 开头\n  aa. 乙中段\n  ab. 丙");
  expect(plan.slice.content.firstChild!.attrs.semloEditorListLevelStarts).toBeNull();
  for (const [style, prefix] of [
    ["decimal", "1.1."],
    ["chinese", "(一)"],
  ] as const) {
    const source = sequenceClipboardContent();
    source.content![0].attrs!.semloEditorOrderedStyle = style;
    const styled = select(EditorState.create({ doc: createCheckedJSONDocument(source, schema) }));
    const projected = projectNumberingSequenceClipboard(styled)!;
    expect(projected.text.startsWith("  " + prefix)).toBe(true);
    expect(projected.slice.content.firstChild!.attrs.semloEditorOrderedStyle).toBe(style);
  }
});

test("1024项连续同层范围线性判定，同父与closed/cut语义保持", () => {
  const json = sequenceClipboardContent(true);
  const list = json.content![0],
    first = list.content![1],
    last = list.content![3];
  list.content = [
    list.content![0],
    first,
    ...Array.from({ length: 1022 }, (_, index) => ({
      type: "listItem",
      attrs: { ...first.attrs },
      content: [{ type: "paragraph", content: [{ type: "text", text: `成员${index + 1}` }] }],
    })),
    last,
  ];
  const current = select(
    EditorState.create({ doc: createCheckedJSONDocument(json, schema), plugins: [numberingSequencePolicy()] }),
  );
  const plan = projectNumberingSequenceClipboard(current)!;
  expect(plan.slice.content.firstChild!.childCount).toBe(1024);
  expect(plan.text.split("\n")).toHaveLength(1024);
  expect(plan.text.split("\n")[25]).toBe("  z. 成员25");
  expect(plan.text.split("\n")[26]).toBe("  aa. 成员26");
  const after = current.apply(markSequenceOperation(plan.cut!));
  expect(after.doc.firstChild!.childCount).toBe(2);
  expect(after.doc.firstChild!.child(1).textContent).toBe("甲结尾");
  expect(after.doc.firstChild!.child(1).attrs.semloEditorListSequence).toBe("A");
});

test("纯换行产生两个空片段并合并相邻正文，首身份和余组计数保持", () => {
  let current = select(
    EditorState.create({
      doc: createCheckedJSONDocument(sequenceClipboardBoundaryContent(), schema),
      plugins: [numberingSequencePolicy()],
    }),
    "甲开头",
    "乙中段",
    3,
    0,
  );
  expect(current.doc.textBetween(current.selection.from, current.selection.to, "\n")).toBe("\n");
  const plan = projectNumberingSequenceClipboard(current)!;
  expect(plan.text).toBe("  a. \n  a. ");
  expect(plan.slice.content.firstChild!.childCount).toBe(2);
  plan.slice.content.firstChild!.forEach((item) => expect(item.firstChild!.content.size).toBe(0));
  current = current.apply(markSequenceOperation(plan.cut));
  expect(current.doc.firstChild!.child(1).textContent).toBe("甲开头乙中段");
  expect(values(current)).toEqual([1, 1, 1, 2]);
});

test("level2 plain每行四格，Unicode Roman跟随权威项号", () => {
  const current = select(
    EditorState.create({ doc: createCheckedJSONDocument(sequenceClipboardBoundaryContent(2), schema) }),
  );
  const plan = projectNumberingSequenceClipboard(current)!;
  expect(plan.text).toBe("    ⅰ. 开头\n    ⅰ. 乙中段\n    ⅱ. 丙");
  expect(plan.text.split("\n").every((line) => /^ {4}\S/.test(line))).toBe(true);
  expect(plan.text.split("\n").map((line) => line.slice(line.indexOf(". ") + 2))).toEqual(["开头", "乙中段", "丙"]);
  plan.slice.content.firstChild!.forEach((item) => expect(item.attrs.semloEditorListIndent).toBe(2));
});

test("level0 plain不凭空增加缩进", () => {
  const json = sequenceClipboardContent(true),
    list = json.content![0];
  list.content = list.content!.slice(1);
  list.content.forEach((item) => {
    item.attrs!.semloEditorListIndent = 0;
  });
  const current = select(EditorState.create({ doc: createCheckedJSONDocument(json, schema) }));
  expect(projectNumberingSequenceClipboard(current)!.text).toBe("1. 开头\n2. 乙中段\n3. 丙");
});
