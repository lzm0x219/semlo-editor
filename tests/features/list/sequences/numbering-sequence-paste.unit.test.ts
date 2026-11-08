import { expect, test } from "@rstest/core";
import { Extension, getSchema } from "@tiptap/core";
import { closeHistory, history, undo, redo } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";

import { createCheckedJSONDocument } from "../../../../packages/core/src/editor/content/parse";
import { createStarterKitWithCodeFonts } from "../../../../packages/core/src/editor/starter-kit";
import { restartedDrag } from "../../../../packages/core/src/features/blocks/actions/restarted-drag";
import { planNestedLegacyPlainPaste } from "../../../../packages/core/src/features/list/nested-legacy-plain-paste";
import { projectNumberingSequenceClipboard } from "../../../../packages/core/src/features/list/numbering-sequence-clipboard";
import {
  canConvertSequenceChain,
  planEmptySequenceBackspace,
  planSequenceContinuation,
  remapSequenceLinks,
  upgradeSequenceChain,
} from "../../../../packages/core/src/features/list/numbering-sequence-continuation";
import {
  formatSequenceConversionHint,
  parseSequenceConversionHint,
  sequenceConversionHintAttribute,
} from "../../../../packages/core/src/features/list/numbering-sequence-conversion-hint";
import {
  assertNumberingSequenceDocument,
  parseSequenceLink,
  resolveListNumbering,
} from "../../../../packages/core/src/features/list/numbering-sequence-document";
import {
  planNumberingSequencePaste,
  planNumberingSequencePlainPaste,
} from "../../../../packages/core/src/features/list/numbering-sequence-paste";
import {
  markSequenceOperation,
  numberingSequencePolicy,
} from "../../../../packages/core/src/features/list/numbering-sequence-transactions";
import { OrderedListNumbering } from "../../../../packages/core/src/features/list/ordered-numbering";
import { OrderedListStyles } from "../../../../packages/core/src/features/list/ordered-style";
import { ParagraphLayout } from "../../../../packages/core/src/features/text/paragraph-layout";
import { paintBlock } from "../../../../packages/core/src/ui/format-painter/block-format";
import { crossLevelPasteContent } from "../../../fixtures/list/sequences/cross-level-paste-content";
import { nestedLegacyPasteContent } from "../../../fixtures/list/sequences/nested-legacy-paste-content";
import { sequencePasteContent } from "../../../fixtures/list/sequences/numbering-sequence-paste-content";

const schema = getSchema([createStarterKitWithCodeFonts([]), ParagraphLayout, OrderedListStyles, OrderedListNumbering]);
function state(content = sequencePasteContent(), targetSchema = schema) {
  return EditorState.create({
    doc: createCheckedJSONDocument(content, targetSchema),
    plugins: [numberingSequencePolicy(), history()],
  });
}
function select(current: EditorState, first: string, a: number, last = first, b = a) {
  let from = -1,
    to = -1;
  current.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.textContent === first) from = pos + 1 + a;
    if (node.type.name === "paragraph" && node.textContent === last) to = pos + 1 + b;
  });
  return current.apply(current.tr.setSelection(TextSelection.create(current.doc, from, to)));
}

function plainLines(...lines: string[]) {
  return new Slice(
    Fragment.fromArray(lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined))),
    1,
    1,
  );
}

function linkedDragBaseline() {
  const content = sequencePasteContent();
  const list = content.content![0];
  list.attrs!.semloEditorListSequences.sequences = list.attrs!.semloEditorListSequences.sequences.filter(
    (sequence: { id: string }) => sequence.id !== "B",
  );
  for (const item of list.content!.slice(1)) {
    item.attrs!.semloEditorListSequence = "A";
    item.attrs!.semloEditorListRestart = false;
  }
  let current = select(state(content), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  return current.apply(closeHistory(markSequenceOperation(plan.transaction)));
}

test("续接升级要求整条链有效并保留原始文档", () => {
  const linked = linkedDragBaseline().doc;
  const plan = upgradeSequenceChain(linked, 0);
  expect(canConvertSequenceChain(linked, 0)).toBe(true);
  expect(plan?.length).toBe(2);
  expect(plan?.every(({ node }) => String(node.attrs.semloEditorListSequenceLink).startsWith("v2:"))).toBe(true);
  expect(String(linked.child(0).attrs.semloEditorListSequenceLink)).toMatch(/^v1:/);

  const content = sequencePasteContent();
  content.content![0].attrs!.semloEditorListSequenceLink = "v1:_:missing";
  const orphan = state(content).doc;
  expect(canConvertSequenceChain(orphan, 0)).toBe(false);
  expect(upgradeSequenceChain(orphan, 0)).toBeNull();
});

function itemPosition(current: EditorState, text: string): number {
  let found = -1;
  current.doc.descendants((node, pos) => {
    if (node.type.name === "listItem" && node.textContent === text) found = pos;
  });
  if (found < 0) throw new Error(`未找到列表项：${text}`);
  return found;
}

test("后段首子项拖到前段子项前提升为根项，后段编号继续联动", () => {
  let current = linkedDragBaseline();
  const before = current.doc;
  const transaction = restartedDrag(current, itemPosition(current, "中段"), itemPosition(current, "甲一"), true);
  expect(transaction).not.toBeNull();
  current = current.apply(closeHistory(transaction!));
  expect(current.doc.child(0).content.content.map((item) => item.textContent)).toEqual(["父", "中段", "甲一"]);
  expect(current.doc.child(0).content.content.map((item) => item.attrs.semloEditorListIndent)).toEqual([0, 0, 1]);
  expect(resolveListNumbering(current.doc.child(0))).toMatchObject({ ok: true, value: { values: [1, 2, 1] } });
  expect(resolveListNumbering(current.doc.child(2))).toMatchObject({ ok: true, value: { values: [2, 3] } });
  const moved = current.doc;
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(before)).toBe(true);
  expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(moved)).toBe(true);
  current = select(current, "甲一", 2);
  expect(splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(resolveListNumbering(current.doc.child(2))).toMatchObject({ ok: true, value: { values: [3, 4] } });
});

test("嵌套旧列表仅在已观察的跨子项纯文本粘贴中转换", () => {
  const original = select(state(nestedLegacyPasteContent()), "甲开头", 1, "乙中段", 1);
  const plan = planNestedLegacyPlainPaste(original, plainLines("一", "二"));
  expect(plan).not.toBeNull();
  let current = original.apply(closeHistory(markSequenceOperation(plan!)));
  expect(current.doc.content.content.map((node) => node.type.name)).toEqual([
    "orderedList",
    "paragraph",
    "orderedList",
    "paragraph",
  ]);
  expect(current.doc.lastChild!.textContent).toBe("尾段");
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(original.doc)).toBe(true);
  expect(current.selection.toJSON()).toEqual(original.selection.toJSON());
  const reverse = original.apply(
    original.tr.setSelection(TextSelection.create(original.doc, original.selection.to, original.selection.from)),
  );
  const reversePlan = planNestedLegacyPlainPaste(reverse, plainLines("一", "二"));
  expect(reversePlan).not.toBeNull();
  let reversed = reverse.apply(closeHistory(markSequenceOperation(reversePlan!)));
  expect(undo(reversed, (tr) => (reversed = reversed.apply(tr)))).toBe(true);
  expect(reversed.doc.eq(reverse.doc)).toBe(true);
  expect(reversed.selection.toJSON()).toEqual(reverse.selection.toJSON());
  const changedStart = nestedLegacyPasteContent();
  changedStart.content![0].content![0].content![1].attrs = { start: 2 };
  expect(
    planNestedLegacyPlainPaste(select(state(changedStart), "甲开头", 1, "乙中段", 1), plainLines("一", "二")),
  ).toBeNull();
  expect(
    planNestedLegacyPlainPaste(
      select(state(nestedLegacyPasteContent()), "甲开头", 0, "甲开头", 1),
      plainLines("一", "二"),
    ),
  ).toBeNull();
});

test("嵌套旧列表保留范围外子项，多段正文拆分后仍可移动续接首项", () => {
  let current = select(state(nestedLegacyPasteContent()), "乙中段", 0, "丙结尾", 2);
  const plan = planNestedLegacyPlainPaste(current, plainLines("一", "二", "三"));
  expect(plan).not.toBeNull();
  current = current.apply(closeHistory(markSequenceOperation(plan!)));
  expect(current.doc.child(0).content.content.map((item) => item.textContent)).toEqual(["父", "甲开头", "一"]);
  expect(current.doc.child(3).content.content.map((item) => item.textContent)).toEqual(["尾", "丁后续"]);
  const moved = restartedDrag(current, itemPosition(current, "尾"), itemPosition(current, "甲开头"), true);
  expect(moved).not.toBeNull();
  current = current.apply(closeHistory(moved!));
  expect(current.doc.child(0).content.content.map((item) => item.textContent)).toEqual(["父", "尾", "甲开头", "一"]);
  expect(resolveListNumbering(current.doc.child(3))).toMatchObject({ ok: true, value: { values: [3] } });
});

test("续接拖动只接管已验证的两个片段与目标位置", () => {
  const current = linkedDragBaseline();
  expect(restartedDrag(current, itemPosition(current, "中段"), itemPosition(current, "甲一"), false)).toBeNull();
  expect(restartedDrag(current, itemPosition(current, "丙结尾"), itemPosition(current, "甲一"), true)).toBeNull();
  expect(restartedDrag(current, itemPosition(current, "中段"), itemPosition(current, "父"), true)).toBeNull();
  const unrelated = current.doc.toJSON();
  unrelated.content[0].attrs.semloEditorListSequenceLink = null;
  unrelated.content[2].attrs.semloEditorListSequenceLink = null;
  const separate = state(unrelated);
  expect(restartedDrag(separate, itemPosition(separate, "中段"), itemPosition(separate, "甲一"), true)).toBeNull();
  const changedOrigin = current.doc.toJSON();
  changedOrigin.content[2].attrs.semloEditorListSequences.sequences.find(
    (sequence: { id: string }) => sequence.id === "A",
  ).origin = "restart";
  const mismatched = state(changedOrigin);
  expect(
    restartedDrag(mismatched, itemPosition(mismatched, "中段"), itemPosition(mismatched, "甲一"), true),
  ).toBeNull();
});

for (const reverse of [false, true])
  test(`根项至最后子项的选区可接收同级列表片段${reverse ? "（反向）" : ""}`, () => {
    const initial = state(crossLevelPasteContent());
    const source = projectNumberingSequenceClipboard(select(initial, "父乙", 1, "父丙", 1));
    expect(source).not.toBeNull();
    let current = select(initial, "父甲", 1, "子乙", 1);
    if (reverse)
      current = current.apply(
        current.tr.setSelection(TextSelection.create(current.doc, current.selection.to, current.selection.from)),
      );
    const before = current.doc;
    const selected = current.selection.toJSON();
    const plan = planNumberingSequencePaste(current, source!.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
    const list = current.doc.firstChild!;
    expect(list.content.content.map((item) => item.textContent)).toEqual(["父乙", "父乙", "父乙", "父丙"]);
    expect(list.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual(["R", "R", "R", "R"]);
    const numbering = resolveListNumbering(list);
    expect(numbering.ok && numbering.value.values).toEqual([1, 2, 3, 4]);
    expect(current.doc.lastChild!.textContent).toBe("尾段");
    const after = current.doc;
    expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
    expect(current.selection.toJSON()).toEqual(selected);
    expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(after)).toBe(true);
  });

for (const reverse of [false, true])
  test(`根项至部分子项的选区粘贴后未选子项归属最后新根项${reverse ? "（反向）" : ""}`, () => {
    const initial = state(crossLevelPasteContent());
    const source = projectNumberingSequenceClipboard(select(initial, "父乙", 1, "父丙", 1))!;
    let current = select(initial, "父甲", 1, "子甲", 1);
    if (reverse)
      current = current.apply(
        current.tr.setSelection(TextSelection.create(current.doc, current.selection.to, current.selection.from)),
      );
    const before = current.doc;
    const selected = current.selection.toJSON();
    const plan = planNumberingSequencePaste(current, source.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
    const list = current.doc.firstChild!;
    expect(list.content.content.map((item) => item.textContent)).toEqual(["父乙", "父甲", "子乙", "父乙", "父丙"]);
    expect(list.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual(["R", "R", "C", "R", "R"]);
    const numbering = resolveListNumbering(list);
    expect(numbering.ok && numbering.value.values).toEqual([1, 2, 1, 3, 4]);
    expect(current.doc.lastChild!.textContent).toBe("尾段");
    const after = current.doc;
    expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
    expect(current.selection.toJSON()).toEqual(selected);
    expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(after)).toBe(true);
  });

test("跨父子项粘贴不猜测不同来源的后续子项或更深层级", () => {
  const initial = state(crossLevelPasteContent());
  const source = projectNumberingSequenceClipboard(select(initial, "父乙", 1, "父丙", 1))!;
  const restarted = crossLevelPasteContent();
  restarted.content![0].content![2].attrs!.semloEditorListSequence = "D";
  restarted.content![0].content![2].attrs!.semloEditorListRestart = true;
  restarted.content![0].attrs!.semloEditorListSequences.sequences.push({ id: "D", start: 1, origin: "restart" });
  const partial = select(state(restarted), "父甲", 1, "子甲", 1);
  expect(planNumberingSequencePaste(partial, source.slice).kind).toBe("reject");
  const deeper = crossLevelPasteContent();
  deeper.content![0].content![2].attrs!.semloEditorListIndent = 2;
  deeper.content![0].content![2].attrs!.semloEditorListSequence = "D";
  deeper.content![0].attrs!.semloEditorListSequences.sequences.push({ id: "D", start: 1, origin: "initial" });
  const nested = select(state(deeper), "父甲", 1, "子乙", 1);
  expect(planNumberingSequencePaste(nested, source.slice).kind).toBe("reject");
});

test("纯文本拆分后，目标序列和交错的独立序列分别接续原计数", () => {
  const content = sequencePasteContent();
  content.content![0].content![3].attrs!.semloEditorListSequence = "A";
  const initial = state(content),
    current = select(initial, "甲开头", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const left = plan.transaction.doc.child(0),
    right = plan.transaction.doc.child(2);
  expect({ ...left.attrs, semloEditorListSequenceLink: null }).toEqual(initial.doc.child(0).attrs);
  expect(parseSequenceLink(left.attrs.semloEditorListSequenceLink)?.next).toBe(
    parseSequenceLink(right.attrs.semloEditorListSequenceLink)?.previous,
  );
  expect(left.textContent).toBe("父甲一");
  expect(plan.transaction.doc.child(1).textContent).toBe("二");
  expect(right.content.content.map((item) => item.textContent)).toEqual(["开头", "乙中段", "丙结尾", "丁后续"]);
  expect(right.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual(["A", "B", "A", "B"]);
  const numbering = resolveListNumbering(right);
  expect(numbering.ok && numbering.value.values).toEqual([2, 1, 3, 2]);
});

test("目标编号达到上界时，多行纯文本不丢失原内容", () => {
  const content = sequencePasteContent();
  content.content![0].attrs!.semloEditorListSequences.sequences.find(
    (sequence: { id: string }) => sequence.id === "B",
  ).start = 2147483645;
  const current = select(state(content), "丁后续", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  expect(plan).toEqual({ kind: "reject", reason: "numbering" });
  expect(current.doc.child(0).lastChild!.textContent).toBe("丁后续");
});

for (const [name, first, last, leftText, rightText, rightValues, reverse] of [
  ["同一重新编号序列", "乙中段", "丁后续", ["父", "甲开头", "乙  a. 开头"], ["后续"], [2], false],
  ["跨重新编号边界", "甲开头", "乙中段", ["父", "甲  a. 开头"], ["中段", "丙结尾", "丁后续"], [2, 1, 2], false],
  ["反向选区", "甲开头", "乙中段", ["父", "甲  a. 开头"], ["中段", "丙结尾", "丁后续"], [2, 1, 2], true],
] as const)
  test(`跨项纯文本：${name}拆分列表并保持后续编号及单步历史`, () => {
    const initial = state();
    let current = select(initial, first, 1, last, 1);
    if (reverse)
      current = current.apply(
        current.tr.setSelection(TextSelection.create(current.doc, current.selection.to, current.selection.from)),
      );
    const before = current.doc;
    const selection = { anchor: current.selection.anchor, head: current.selection.head };
    const plan = planNumberingSequencePlainPaste(current, plainLines("  a. 开头", "  a. 乙中段", "  b. 丙"));
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    current = current.apply(markSequenceOperation(plan.transaction));
    expect(current.doc.content.content.map((node) => node.type.name)).toEqual([
      "orderedList",
      "paragraph",
      "paragraph",
      "orderedList",
      "paragraph",
    ]);
    expect(current.doc.child(0).content.content.map((item) => item.textContent)).toEqual(leftText);
    expect(current.doc.child(1).textContent).toBe("  a. 乙中段");
    expect(current.doc.child(2).textContent).toBe("  b. 丙");
    const right = current.doc.child(3);
    expect(right.content.content.map((item) => item.textContent)).toEqual(rightText);
    const resolved = resolveListNumbering(right);
    expect(resolved.ok && resolved.value.values).toEqual(rightValues);
    const after = current.doc;
    expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
    expect({ anchor: current.selection.anchor, head: current.selection.head }).toEqual(selection);
    expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(after)).toBe(true);
  });

test("跨项纯文本删除交错序列的成员后，后半段分别接续剩余成员", () => {
  const content = sequencePasteContent();
  const items = content.content![0].content!;
  items[3].attrs!.semloEditorListSequence = "A";
  items.push(
    {
      ...structuredClone(items[1]),
      content: [
        { type: "paragraph", attrs: { semloEditorLineHeight: "2" }, content: [{ type: "text", text: "戊最后" }] },
      ],
    },
    {
      ...structuredClone(items[4]),
      content: [
        { type: "paragraph", attrs: { semloEditorLineHeight: "2" }, content: [{ type: "text", text: "己最后" }] },
      ],
    },
  );
  const initial = state(content);
  const selected = select(initial, "乙中段", 1, "丁后续", 1);
  const plan = planNumberingSequencePlainPaste(selected, plainLines("一", "二"));
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const right = plan.transaction.doc.child(2);
  expect(right.content.content.map((item) => item.textContent)).toEqual(["后续", "戊最后", "己最后"]);
  expect(right.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual(["B", "A", "B"]);
  const resolved = resolveListNumbering(right);
  expect(resolved.ok && resolved.value.values).toEqual([2, 2, 3]);
});

test("拆分后在前段新增成员时，后段同序列编号联动且单步撤销", () => {
  const initial = state();
  let current = select(initial, "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("  a. 开头", "  a. 乙中段", "  b. 丙"));
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  current = select(current, "甲  a. 开头", "甲  a. 开头".length);
  const before = current.doc;
  expect(splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)))).toBe(true);
  const resolved = resolveListNumbering(current.doc.child(3));
  expect(resolved.ok && resolved.value.values).toEqual([3, 1, 2]);
  const after = current.doc;
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(before)).toBe(true);
  expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(after)).toBe(true);
});

test("多次拆分后，前段增项会沿关联链更新各段，重载后仍然生效", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const first = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (first.kind !== "apply") throw new Error(first.reason);
  current = current.apply(closeHistory(markSequenceOperation(first.transaction)));
  current = select(current, "中段", 1);
  const second = planNumberingSequencePlainPaste(current, plainLines("三", "四"));
  if (second.kind !== "apply") throw new Error(second.reason);
  current = current.apply(closeHistory(markSequenceOperation(second.transaction)));
  current = state(current.doc.toJSON());
  current = select(current, "甲一", 2);
  expect(splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)))).toBe(true);
  const lists = current.doc.content.content.filter((node) => node.type.name === "orderedList");
  expect(lists).toHaveLength(3);
  expect(
    lists.map((list) => {
      const result = resolveListNumbering(list);
      return result.ok && result.value.values;
    }),
  ).toEqual([[1, 1, 2], [3], [4, 1, 2]]);
});

test("复制完整关联链换新身份，单段复制移除关联，原文与编号不变", () => {
  const initial = select(state(), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(initial, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const doc = plan.transaction.doc;
  const left = doc.child(0),
    right = doc.child(2);
  const original = parseSequenceLink(left.attrs.semloEditorListSequenceLink)!.next;
  const pair = new Slice(Fragment.fromArray([left, doc.child(1), right]), 0, 0);
  const copied = remapSequenceLinks(pair, doc);
  const leftCopy = parseSequenceLink(copied.content.child(0).attrs.semloEditorListSequenceLink);
  const rightCopy = parseSequenceLink(copied.content.child(2).attrs.semloEditorListSequenceLink);
  expect(leftCopy?.next).toBeTruthy();
  expect(leftCopy?.next).not.toBe(original);
  expect(leftCopy?.next).toBe(rightCopy?.previous);
  const isolated = remapSequenceLinks(new Slice(Fragment.from(left), 0, 0), doc);
  expect(isolated.content.firstChild!.attrs.semloEditorListSequenceLink).toBeNull();
  expect(parseSequenceLink(doc.child(0).attrs.semloEditorListSequenceLink)?.next).toBe(original);
});

function checkLinkedPlainSplit(doc: ProseMirrorNode, target: "甲一" | "丙结尾", version: 2 | 3) {
  let current = select(state(doc.toJSON()), target, 1);
  const before = current.doc;
  const plan = planNumberingSequencePlainPaste(current, plainLines("新", "行"));
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
  const after = current.doc;
  const lists = after.content.content.filter((node) => node.type.name === "orderedList");
  expect(lists).toHaveLength(3);
  const links = lists.map((list) => parseSequenceLink(list.attrs.semloEditorListSequenceLink)!);
  expect(links.map((link) => link.version)).toEqual([version, version, version]);
  expect(links[0].next).toBe(links[1].previous);
  expect(links[1].next).toBe(links[2].previous);
  expect(links.map((link) => link.next)).toContain("edge");
  expect(
    lists.map((list) => {
      const numbering = resolveListNumbering(list);
      return numbering.ok && numbering.value.values;
    }),
  ).toEqual(
    target === "甲一"
      ? [[1, 1], [2], [3, 1, 2]]
      : [
          [1, 1],
          [2, 1],
          [2, 3],
        ],
  );
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(before)).toBe(true);
  expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(after)).toBe(true);
  current = state(after.toJSON());
  expect(current.doc.eq(after)).toBe(true);
  const first = target === "甲一" ? "甲新" : "甲一";
  current = select(current, first, first.length);
  expect(splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)))).toBe(true);
  const updated = current.doc.content.content.filter((node) => node.type.name === "orderedList");
  expect(
    updated.map((list) => {
      const numbering = resolveListNumbering(list);
      return numbering.ok && numbering.value.values;
    }),
  ).toEqual(
    target === "甲一"
      ? [[1, 1, 2], [3], [4, 1, 2]]
      : [
          [1, 1, 2],
          [3, 1],
          [2, 3],
        ],
  );
}

test("跨类型 v2 续接复制隔离身份，前后片段可再次拆分", () => {
  const initial = select(state(), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(initial, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const original = plan.transaction.doc;
  const left = original
    .child(0)
    .type.create({ ...original.child(0).attrs, semloEditorListSequenceLink: "v2:_:edge" }, original.child(0).content);
  const right = original
    .child(2)
    .type.create({ ...original.child(2).attrs, semloEditorListSequenceLink: "v2:edge:_" }, original.child(2).content);
  const middle = schema.nodes.bulletList.create(
    null,
    schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text("待办替身"))),
  );
  const doc = schema.topNodeType.create(null, Fragment.fromArray([left, middle, right, original.lastChild!]));
  expect(planSequenceContinuation(doc)).toEqual([]);
  const copy = remapSequenceLinks(new Slice(Fragment.fromArray([left, middle, right]), 0, 0), doc);
  const before = parseSequenceLink(left.attrs.semloEditorListSequenceLink)!;
  const copiedLeft = parseSequenceLink(copy.content.child(0).attrs.semloEditorListSequenceLink)!;
  const copiedRight = parseSequenceLink(copy.content.child(2).attrs.semloEditorListSequenceLink)!;
  expect(copiedLeft.version).toBe(2);
  expect(copiedRight.version).toBe(2);
  expect(copiedLeft.next).toBe(copiedRight.previous);
  expect(copiedLeft.next).not.toBe(before.next);
  expect(
    remapSequenceLinks(new Slice(Fragment.from(left), 0, 0), doc).content.firstChild!.attrs.semloEditorListSequenceLink,
  ).toBeNull();
  checkLinkedPlainSplit(doc, "甲一", 2);
  checkLinkedPlainSplit(doc, "丙结尾", 2);
});

test("交错转换标识随完整续接复制换新身份，单段复制解除来源", () => {
  const initial = select(state(), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(initial, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const original = plan.transaction.doc;
  const left = original
    .child(0)
    .type.create({ ...original.child(0).attrs, semloEditorListSequenceLink: "v2:_:edge" }, original.child(0).content);
  const right = original
    .child(2)
    .type.create({ ...original.child(2).attrs, semloEditorListSequenceLink: "v2:edge:_" }, original.child(2).content);
  const middle = schema.nodes.bulletList.create(
    null,
    schema.nodes.listItem.create(
      { [sequenceConversionHintAttribute]: formatSequenceConversionHint("edge", "B") },
      schema.nodes.paragraph.create(null, schema.text("转换项")),
    ),
  );
  const document = schema.topNodeType.create(null, Fragment.fromArray([left, middle, right, original.lastChild!]));
  expect(createCheckedJSONDocument(document.toJSON(), schema).eq(document)).toBe(true);
  const full = remapSequenceLinks(new Slice(Fragment.fromArray([left, middle, right]), 0, 0), document);
  const copiedLink = parseSequenceLink(full.content.child(0).attrs.semloEditorListSequenceLink)!;
  const copiedHint = parseSequenceConversionHint(
    full.content.child(1).firstChild!.attrs[sequenceConversionHintAttribute],
  );
  expect(copiedHint).toEqual({ edge: copiedLink.next, sequenceId: "B" });
  expect(copiedHint!.edge).not.toBe("edge");
  const partial = remapSequenceLinks(new Slice(Fragment.from(middle), 0, 0), document);
  expect(partial.content.firstChild!.firstChild!.attrs[sequenceConversionHintAttribute]).toBeNull();
  const broken = document.toJSON();
  broken.content![1].content![0].attrs![sequenceConversionHintAttribute] = "not-valid";
  expect(() => createCheckedJSONDocument(broken, schema)).toThrow("编号序列转换标识无效");
  const misplaced = document.toJSON();
  misplaced.content![0].content![0].attrs![sequenceConversionHintAttribute] = formatSequenceConversionHint("edge", "B");
  expect(() => createCheckedJSONDocument(misplaced, schema)).toThrow("编号序列转换标识无效");
});

test("正文和标题的转换标识随完整复制换新边，独立复制解除来源", () => {
  const plan = planNumberingSequencePlainPaste(select(state(), "甲开头", 1, "乙中段", 1), plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const original = plan.transaction.doc;
  const left = original
    .child(0)
    .type.create({ ...original.child(0).attrs, semloEditorListSequenceLink: "v3:_:edge" }, original.child(0).content);
  const right = original
    .child(2)
    .type.create({ ...original.child(2).attrs, semloEditorListSequenceLink: "v3:edge:_" }, original.child(2).content);
  const paragraph = schema.nodes.paragraph.create(
    { [sequenceConversionHintAttribute]: formatSequenceConversionHint("edge", "B") },
    schema.text("正文"),
  );
  const heading = schema.nodes.heading.create(
    { level: 3, [sequenceConversionHintAttribute]: formatSequenceConversionHint("edge", "A") },
    schema.text("标题"),
  );
  const document = schema.topNodeType.create(null, Fragment.fromArray([left, paragraph, heading, right]));
  expect(createCheckedJSONDocument(document.toJSON(), schema).eq(document)).toBe(true);
  const full = remapSequenceLinks(new Slice(document.content, 0, 0), document);
  const edge = parseSequenceLink(full.content.child(0).attrs.semloEditorListSequenceLink)!.next;
  expect(edge).not.toBe("edge");
  expect(parseSequenceConversionHint(full.content.child(1).attrs[sequenceConversionHintAttribute])).toEqual({
    edge,
    sequenceId: "B",
  });
  expect(parseSequenceConversionHint(full.content.child(2).attrs[sequenceConversionHintAttribute])).toEqual({
    edge,
    sequenceId: "A",
  });
  const partial = remapSequenceLinks(new Slice(Fragment.from(paragraph), 0, 0), document);
  expect(partial.content.firstChild!.attrs[sequenceConversionHintAttribute]).toBeNull();
  const nested = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, paragraph));
  const nestedDocument = schema.topNodeType.create(null, Fragment.fromArray([left, nested, right]));
  expect(createCheckedJSONDocument(nestedDocument.toJSON(), schema).eq(nestedDocument)).toBe(true);
  const invalid = schema.nodes.orderedList.create(null, schema.nodes.listItem.create(null, paragraph));
  const invalidDocument = schema.topNodeType.create(null, Fragment.fromArray([invalid]));
  expect(() => createCheckedJSONDocument(invalidDocument.toJSON(), schema)).toThrow("编号序列转换标识无效");
});

test("带来源的正文转为无序列表时保留续接和原序列", () => {
  const list = (link: string, start: number) => ({
    type: "orderedList",
    attrs: {
      semloEditorListSequenceLink: link,
      semloEditorListSequences: {
        version: 1,
        sequences: [
          { id: "A", start, origin: "initial" },
          { id: "B", start, origin: "restart" },
        ],
      },
    },
    content: ["A", "B"].map((id) => ({
      type: "listItem",
      attrs: { semloEditorListSequence: id },
      content: [{ type: "paragraph", content: [{ type: "text", text: id }] }],
    })),
  });
  const initial = state({
    type: "doc",
    content: [
      list("v2:_:edge", 1),
      {
        type: "paragraph",
        attrs: { [sequenceConversionHintAttribute]: formatSequenceConversionHint("edge", "B") },
        content: [{ type: "text", text: "乙" }],
      },
      {
        type: "paragraph",
        attrs: { [sequenceConversionHintAttribute]: formatSequenceConversionHint("edge", "A") },
        content: [{ type: "text", text: "丙" }],
      },
      list("v2:edge:_", 2),
    ],
  });
  const selected = select(initial, "乙", 0, "丙", 1);
  let candidate: import("@tiptap/pm/state").Transaction | undefined;
  expect(
    wrapInList(schema.nodes.bulletList)(selected, (transaction) => {
      candidate = transaction;
    }),
  ).toBe(true);
  expect(candidate).toBeDefined();
  expect(() => assertNumberingSequenceDocument(candidate!.doc)).not.toThrow();
  expect(planSequenceContinuation(candidate!.doc, selected.doc)).not.toBeNull();
  expect(selected.applyTransaction(candidate!).transactions.length).toBeGreaterThan(0);
  let altered: import("@tiptap/pm/state").Transaction | undefined;
  wrapInList(schema.nodes.bulletList)(selected, (transaction) => {
    altered = transaction;
  });
  const rightPos = altered!.doc.content.size - altered!.doc.lastChild!.nodeSize;
  altered!.insertText("改", rightPos + 3);
  expect(selected.applyTransaction(altered!).transactions).toHaveLength(0);
});

test("标题隔开的 v3 续接保留版本与复制隔离，不改变旧版 v2 语义", () => {
  const initial = select(state(), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(initial, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const original = plan.transaction.doc;
  const make = (version: 2 | 3) => {
    const left = original
      .child(0)
      .type.create(
        { ...original.child(0).attrs, semloEditorListSequenceLink: `v${version}:_:edge` },
        original.child(0).content,
      );
    const right = original
      .child(2)
      .type.create(
        { ...original.child(2).attrs, semloEditorListSequenceLink: `v${version}:edge:_` },
        original.child(2).content,
      );
    const middle = schema.nodes.heading.create({ level: 3 }, schema.text("标题"));
    return schema.topNodeType.create(null, Fragment.fromArray([left, middle, right, original.lastChild!]));
  };
  const doc = make(3);
  expect(planSequenceContinuation(doc)).toEqual([]);
  const copy = remapSequenceLinks(new Slice(Fragment.fromArray([doc.child(0), doc.child(1), doc.child(2)]), 0, 0), doc);
  const left = parseSequenceLink(copy.content.child(0).attrs.semloEditorListSequenceLink)!;
  const right = parseSequenceLink(copy.content.child(2).attrs.semloEditorListSequenceLink)!;
  expect(left.version).toBe(3);
  expect(right.version).toBe(3);
  expect(left.next).toBe(right.previous);
  expect(left.next).not.toBe("edge");
  checkLinkedPlainSplit(doc, "甲一", 3);
  checkLinkedPlainSplit(doc, "丙结尾", 3);
  const old = planSequenceContinuation(make(2));
  expect(old).toHaveLength(2);
  expect(old?.every(({ node }) => node.attrs.semloEditorListSequenceLink === null)).toBe(true);
  expect(
    planNumberingSequencePlainPaste(select(state(make(2).toJSON()), "甲一", 1), plainLines("新", "行")),
  ).toMatchObject({ kind: "reject", reason: "numbering" });
  const invalid = select(state(make(2).toJSON()), "甲一", 1);
  const transaction = invalid.tr;
  expect(paintBlock(transaction, invalid.selection as TextSelection, { kind: "paragraph", layout: {} })).toBeNull();
  expect(transaction.doc.eq(invalid.doc)).toBe(true);
});

test("关联字段版本、重复端点和嵌套位置无效时拒绝输入", () => {
  for (const value of ["v4:_:a", "v1:_:_", "v1:a:a", "v1:_:" + "a".repeat(65), 42]) {
    const invalid = sequencePasteContent();
    invalid.content![0].attrs!.semloEditorListSequenceLink = value;
    const before = structuredClone(invalid);
    expect(() => createCheckedJSONDocument(invalid, schema)).toThrow("编号序列关联");
    expect(invalid).toEqual(before);
  }
  const duplicate = sequencePasteContent();
  duplicate.content![0].attrs!.semloEditorListSequenceLink = "v1:_:same";
  duplicate.content!.push(structuredClone(duplicate.content![0]));
  expect(() => createCheckedJSONDocument(duplicate, schema)).toThrow("编号序列关联重复");
  const nested = {
    type: "doc",
    content: [{ type: "blockquote", content: [structuredClone(duplicate.content![0])] }],
  };
  expect(() => createCheckedJSONDocument(nested, schema)).toThrow("编号序列关联无效");
});

test("删除前段时后段按剩余成员重算并解除关联，撤销恢复关联", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  current = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, 0)));
  const before = current.doc;
  current = current.apply(current.tr.deleteSelection());
  const right = current.doc.child(1);
  const result = resolveListNumbering(right);
  expect(result.ok && result.value.values).toEqual([1, 1, 2]);
  expect(right.attrs.semloEditorListSequenceLink).toBeNull();
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(before)).toBe(true);
});

test("删除续接链中间片段后，前后段继续联动并可逐步撤销", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const first = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (first.kind !== "apply") throw new Error(first.reason);
  current = current.apply(closeHistory(markSequenceOperation(first.transaction)));
  current = select(current, "中段", 1);
  const second = planNumberingSequencePlainPaste(current, plainLines("三", "四"));
  if (second.kind !== "apply") throw new Error(second.reason);
  current = current.apply(closeHistory(markSequenceOperation(second.transaction)));
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  const beforeDelete = current.doc;
  const middlePos = current.doc.child(0).nodeSize + current.doc.child(1).nodeSize;
  current = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, middlePos)));
  current = current.apply(closeHistory(current.tr.deleteSelection()));
  const afterDelete = current.doc;
  const left = current.doc.child(0),
    right = current.doc.child(3);
  expect(parseSequenceLink(left.attrs.semloEditorListSequenceLink)?.next).toBe(
    parseSequenceLink(right.attrs.semloEditorListSequenceLink)?.previous,
  );
  expect(parseSequenceLink(left.attrs.semloEditorListSequenceLink)?.next).toBeTruthy();
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  current = select(current, "甲一", 2);
  expect(splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)))).toBe(true);
  const resolved = resolveListNumbering(current.doc.child(3));
  expect(resolved.ok && resolved.value.values).toEqual([3, 1, 2]);
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(afterDelete)).toBe(true);
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(beforeDelete)).toBe(true);
});

test("中段删除后的目标含前段未知序列时，不猜测前后关联", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const first = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (first.kind !== "apply") throw new Error(first.reason);
  current = current.apply(markSequenceOperation(first.transaction));
  current = select(current, "中段", 1);
  const second = planNumberingSequencePlainPaste(current, plainLines("三", "四"));
  if (second.kind !== "apply") throw new Error(second.reason);
  current = current.apply(markSequenceOperation(second.transaction));
  const tail = current.doc.child(4);
  const tailPos = Array.from({ length: 4 }, (_, index) => current.doc.child(index).nodeSize).reduce((a, b) => a + b, 0);
  const registry = tail.attrs.semloEditorListSequences;
  const changed = current.tr.setNodeMarkup(tailPos, undefined, {
    ...tail.attrs,
    semloEditorListSequences: {
      ...registry,
      sequences: [...registry.sequences, { id: "D", start: 1, origin: "restart" }],
    },
  });
  changed.setNodeMarkup(tailPos + 1 + tail.child(0).nodeSize, undefined, {
    ...tail.child(1).attrs,
    semloEditorListSequence: "D",
  });
  current = current.apply(markSequenceOperation(changed));
  const middlePos = current.doc.child(0).nodeSize + current.doc.child(1).nodeSize;
  current = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, middlePos)));
  current = current.apply(current.tr.deleteSelection());
  expect(current.doc.child(0).attrs.semloEditorListSequenceLink).toBeNull();
  expect(current.doc.child(3).attrs.semloEditorListSequenceLink).toBeNull();
  const right = resolveListNumbering(current.doc.child(3));
  expect(right.ok && right.value.sequenceIds).toEqual(["A", "D", "B"]);
});

test("空续接子项两次退格依次调整层级、退出列表，并可分别撤销", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const first = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (first.kind !== "apply") throw new Error(first.reason);
  current = current.apply(closeHistory(markSequenceOperation(first.transaction)));
  current = select(current, "中段", 1);
  const second = planNumberingSequencePlainPaste(current, plainLines("三", "四"));
  if (second.kind !== "apply") throw new Error(second.reason);
  current = current.apply(closeHistory(markSequenceOperation(second.transaction)));
  current = select(current, "中三", 0, "中三", 2);
  current = current.apply(closeHistory(current.tr.deleteSelection()));
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  const child = current.doc;
  const outdent = planEmptySequenceBackspace(current);
  expect(outdent).not.toBeNull();
  current = current.apply(closeHistory(markSequenceOperation(outdent!)));
  const rootItem = current.doc;
  expect(current.doc.child(2).firstChild!.attrs.semloEditorListIndent).toBe(0);
  const middle = resolveListNumbering(current.doc.child(2));
  const tail = resolveListNumbering(current.doc.child(4));
  expect(middle.ok && middle.value.values).toEqual([2]);
  expect(tail.ok && tail.value.values).toEqual([1, 1, 2]);
  current = current.apply(closeHistory(current.tr).setMeta("addToHistory", false));
  const exit = planEmptySequenceBackspace(current);
  expect(exit).not.toBeNull();
  current = current.apply(closeHistory(markSequenceOperation(exit!)));
  const paragraph = current.doc;
  expect(current.doc.child(2).type.name).toBe("paragraph");
  const connected = resolveListNumbering(current.doc.child(4));
  expect(connected.ok && connected.value.values).toEqual([2, 1, 2]);
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(rootItem)).toBe(true);
  expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(child)).toBe(true);
  expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
  expect(current.doc.eq(paragraph)).toBe(true);
});

test("续接退格只接管已验证的空子项，不扩大到非空或普通列表", () => {
  let current = select(state(), "甲开头", 1, "乙中段", 1);
  const first = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (first.kind !== "apply") throw new Error(first.reason);
  current = current.apply(markSequenceOperation(first.transaction));
  current = select(current, "中段", 1);
  const second = planNumberingSequencePlainPaste(current, plainLines("三", "四"));
  if (second.kind !== "apply") throw new Error(second.reason);
  current = current.apply(markSequenceOperation(second.transaction));
  expect(planEmptySequenceBackspace(select(current, "中三", 0))).toBeNull();
  expect(planEmptySequenceBackspace(select(current, "中三", 0, "中三", 2))).toBeNull();
  expect(planEmptySequenceBackspace(select(state(), "甲开头", 0))).toBeNull();
});

test("关联后段的编号会溢出时拒绝前段增项，保留原文和编号", () => {
  const content = sequencePasteContent();
  content.content![0].attrs!.semloEditorListSequences.sequences.find(
    (sequence: { id: string }) => sequence.id === "A",
  ).start = 2147483646;
  let current = select(state(content), "甲开头", 1, "乙中段", 1);
  const plan = planNumberingSequencePlainPaste(current, plainLines("一", "二"));
  if (plan.kind !== "apply") throw new Error(plan.reason);
  current = current.apply(closeHistory(markSequenceOperation(plan.transaction)));
  current = select(current, "甲一", 2);
  const before = current.doc;
  splitListItem(schema.nodes.listItem)(current, (tr) => (current = current.apply(tr)));
  expect(current.doc.eq(before)).toBe(true);
  const right = resolveListNumbering(current.doc.child(2));
  expect(right.ok && right.value.values).toEqual([2147483647, 1, 2]);
});

test("段内粘贴计划合首尾并接续目标身份，单步恢复正文/marks/registry", () => {
  const initial = state();
  const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
  let current = select(initial, "丁后续", 1);
  const before = current.doc;
  const plan = planNumberingSequencePaste(current, source.slice);
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  current = current.apply(markSequenceOperation(plan.transaction));
  expect(current.doc.firstChild!.content.content.map((item) => item.textContent)).toEqual([
    "父",
    "甲开头",
    "乙中段",
    "丙结尾",
    "丁开头",
    "乙中段",
    "丙后续",
  ]);
  expect(current.doc.firstChild!.attrs).toEqual(before.firstChild!.attrs);
  expect(current.doc.firstChild!.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual([
    "R",
    "A",
    "B",
    "B",
    "B",
    "B",
    "B",
  ]);
  const numbering = resolveListNumbering(current.doc.firstChild!);
  expect(numbering.ok && numbering.value.values).toEqual([1, 1, 1, 2, 3, 4, 5]);
  expect(current.selection.$from.parentOffset).toBe(1);
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
  expect(initial.doc).toBe(before);
});

test("已声明的宿主list/listItem属性相等时保留，任一源冲突不静默覆盖为目标值", () => {
  const hostSchema = getSchema([
    createStarterKitWithCodeFonts([]),
    ParagraphLayout,
    OrderedListStyles,
    OrderedListNumbering,
    Extension.create({
      name: "hostListSettings",
      addGlobalAttributes() {
        return [
          { types: ["orderedList"], attributes: { hostListSetting: { default: null } } },
          { types: ["listItem"], attributes: { hostItemSetting: { default: null } } },
        ];
      },
    }),
  ]);
  const content = sequencePasteContent();
  content.content![0].attrs!.hostListSetting = { theme: "shared", revision: 1 };
  content.content![0].content!.forEach((item) => {
    item.attrs!.hostItemSetting = "shared";
  });
  const initial = state(content, hostSchema);
  const slice = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice;
  const source = slice.content.firstChild!;
  const target = select(initial, "丁后续", 1);
  const equal = source.type.create(
    { ...source.attrs, hostListSetting: { revision: 1, theme: "shared" } },
    source.content,
  );
  const accepted = planNumberingSequencePaste(target, new Slice(Fragment.from(equal), 0, 0));
  expect(accepted.kind).toBe("apply");
  if (accepted.kind !== "apply") throw new Error(accepted.reason);
  expect(accepted.transaction.doc.firstChild!.attrs.hostListSetting).toEqual({ theme: "shared", revision: 1 });
  expect(
    accepted.transaction.doc.firstChild!.content.content.slice(-3).map((item) => item.attrs.hostItemSetting),
  ).toEqual(["shared", "shared", "shared"]);
  const conflictingList = source.type.create(
    { ...source.attrs, hostListSetting: { theme: "foreign", revision: 1 } },
    source.content,
  );
  expect(planNumberingSequencePaste(target, new Slice(Fragment.from(conflictingList), 0, 0)).kind).toBe("reject");
  for (const index of [0, 1, 2]) {
    const children = [...source.content.content];
    children[index] = children[index].type.create(
      { ...children[index].attrs, hostItemSetting: "foreign" },
      children[index].content,
    );
    const conflict = source.copy(Fragment.fromArray(children));
    expect(planNumberingSequencePaste(target, new Slice(Fragment.from(conflict), 0, 0)).kind).toBe("reject");
  }
  const incompatibleTarget = structuredClone(content);
  incompatibleTarget.content![0].content![3].attrs!.hostItemSetting = "different";
  const selected = select(state(incompatibleTarget, hostSchema), "乙中段", 1, "丁后续", 1);
  expect(planNumberingSequencePaste(selected, slice)).toEqual({ kind: "reject", reason: "target" });
  expect(planNumberingSequencePlainPaste(selected, plainLines("一", "二"))).toEqual({
    kind: "reject",
    reason: "target",
  });
  expect(selected.doc.firstChild!.child(3).attrs.hostItemSetting).toBe("different");
  expect(target.doc.eq(initial.doc)).toBe(true);
});

for (const [name, sourceA, sourceLast, sourceB, target, a, b, expected, values] of [
  [
    "目标段首",
    1,
    "丙结尾",
    1,
    "甲开头",
    0,
    0,
    ["父", "开头", "乙中段", "丙甲开头", "乙中段", "丙结尾", "丁后续"],
    [1, 1, 2, 3, 1, 2, 3],
  ],
  [
    "目标段内替换",
    1,
    "丙结尾",
    1,
    "丁后续",
    1,
    2,
    ["父", "甲开头", "乙中段", "丙结尾", "丁开头", "乙中段", "丙续"],
    [1, 1, 1, 2, 3, 4, 5],
  ],
  ["纯换行", 3, "乙中段", 0, "丁后续", 1, 1, ["父", "甲开头", "乙中段", "丙结尾", "丁", "后续"], [1, 1, 1, 2, 3, 4]],
] as const)
  test(`原生向量${name}保留两端与精确一次历史`, () => {
    const initial = state();
    const source = projectNumberingSequenceClipboard(select(initial, "甲开头", sourceA, sourceLast, sourceB))!;
    let current = select(initial, target, a, target, b);
    const before = current.doc;
    const plan = planNumberingSequencePaste(current, source.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    current = current.apply(markSequenceOperation(plan.transaction));
    expect(current.doc.firstChild!.content.content.map((item) => item.textContent)).toEqual(expected);
    const resolved = resolveListNumbering(current.doc.firstChild!);
    expect(resolved.ok && resolved.value.values).toEqual(values);
    expect(current.doc.firstChild!.attrs).toEqual(before.firstChild!.attrs);
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

for (const level of [0, 2, 8])
  test(`同层level${level}保持目标scope，level8为项目扩展`, () => {
    const initial = state(sequencePasteContent(level));
    const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
    const current = select(initial, "丁后续", 1);
    const plan = planNumberingSequencePaste(current, source.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    const after = current.apply(markSequenceOperation(plan.transaction)).doc.firstChild!;
    expect(after.content.content.slice(-3).map((item) => item.textContent)).toEqual(["丁开头", "乙中段", "丙后续"]);
    expect(after.content.content.slice(-3).map((item) => item.attrs.semloEditorListIndent)).toEqual([
      level,
      level,
      level,
    ]);
    expect(after.content.content.slice(-3).map((item) => item.attrs.semloEditorListSequence)).toEqual(["B", "B", "B"]);
  });

test("目标段尾及整段替换保留空边界，光标在源末与原suffix之间", () => {
  const initial = state();
  const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
  for (const [a, b, expected] of [
    [3, 3, ["丁后续开头", "乙中段", "丙"]],
    [0, 3, ["开头", "乙中段", "丙"]],
  ] as const) {
    const current = select(initial, "丁后续", a, "丁后续", b);
    const plan = planNumberingSequencePaste(current, source.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    const after = current.apply(markSequenceOperation(plan.transaction));
    expect(after.doc.firstChild!.content.content.slice(-3).map((item) => item.textContent)).toEqual(expected);
    expect(after.selection.$from.parentOffset).toBe(1);
  }
});

test("交错的后续同ID接续、别序列与未引用registry/start/origin不变", () => {
  const content = sequencePasteContent();
  const list = content.content![0];
  (list.attrs!.semloEditorListSequences as { sequences: object[] }).sequences.push({
    id: "unused",
    start: 7,
    origin: "restart",
  });
  for (const [text, id] of [
    ["戊别序列", "A"],
    ["己后续", "B"],
  ]) {
    const item = structuredClone(list.content![4]);
    item.attrs!.semloEditorListSequence = id;
    item.content![0].content = [{ type: "text", text }];
    list.content!.push(item);
  }
  const initial = state(content);
  const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
  const current = select(initial, "丁后续", 1);
  const plan = planNumberingSequencePaste(current, source.slice);
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const after = current.apply(markSequenceOperation(plan.transaction));
  const resolved = resolveListNumbering(after.doc.firstChild!);
  expect(resolved.ok && resolved.value.values).toEqual([1, 1, 1, 2, 3, 4, 5, 2, 6]);
  expect(after.doc.firstChild!.attrs).toEqual(initial.doc.firstChild!.attrs);
  expect(after.doc.firstChild!.child(7).eq(initial.doc.firstChild!.child(5))).toBe(true);
});

test("合法负起点保留，新增导致int32溢出时原子拒绝", () => {
  for (const start of [-3, 2147483645]) {
    const content = sequencePasteContent();
    (
      content.content![0].attrs!.semloEditorListSequences as { sequences: { id: string; start: number }[] }
    ).sequences[2].start = start;
    const initial = state(content);
    const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
    const current = select(initial, "丁后续", 1);
    const plan = planNumberingSequencePaste(current, source.slice);
    if (start > 0) expect(plan.kind).toBe("reject");
    else {
      expect(plan.kind).toBe("apply");
      if (plan.kind !== "apply") throw new Error(plan.reason);
      const after = current.apply(markSequenceOperation(plan.transaction));
      const resolved = resolveListNumbering(after.doc.firstChild!);
      expect(resolved.ok && resolved.value.values).toEqual([1, 1, -3, -2, -1, 0, 1]);
    }
    expect(current.doc.eq(initial.doc)).toBe(true);
  }
});

test("不同层/style、种子/来源/身份、开放或未知结构一律不计划写入", () => {
  const initial = state();
  const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice;
  const current = select(initial, "丁后续", 1);
  const list = source.content.firstChild!;
  const rejects: Slice[] = [new Slice(source.content, 1, 1), Slice.empty];
  for (const attrs of [
    { start: 7 },
    { semloEditorOrderedStyle: "decimal" },
    { semloEditorOrderedStyle: "unknown" },
    { type: "i" },
    { semloEditorListSequences: { version: 2, sequences: [] } },
    { semloEditorListLevelStarts: { 1: 2 } },
    { semloEditorOrderedAncestorPath: [3] },
    { semloEditorListQuoteChain: [1] },
    { semloEditorListTaskChain: [1] },
    { semloEditorListFirstContinue: true },
    { semloEditorListFirstContinue: "unknown" },
  ])
    rejects.push(new Slice(Fragment.from(list.type.create({ ...list.attrs, ...attrs }, list.content)), 0, 0));
  for (const attrs of [
    { semloEditorListIndent: 2 },
    { semloEditorListRestart: true },
    { semloEditorListRestart: "unknown" },
    { semloEditorListSequence: "foreign" },
  ]) {
    const children = list.content.content.map((item) => item.type.create({ ...item.attrs, ...attrs }, item.content));
    rejects.push(new Slice(Fragment.from(list.copy(Fragment.fromArray(children))), 0, 0));
  }
  const atom = schema.nodes.hardBreak.create();
  const first = list.firstChild!,
    p = first.firstChild!;
  const withAtom = first.copy(Fragment.from(p.copy(p.content.append(Fragment.from(atom)))));
  rejects.push(
    new Slice(Fragment.from(list.copy(Fragment.fromArray([withAtom, ...list.content.content.slice(1)]))), 0, 0),
  );
  const nested = first.copy(first.content.append(Fragment.from(list)));
  rejects.push(
    new Slice(Fragment.from(list.copy(Fragment.fromArray([nested, ...list.content.content.slice(1)]))), 0, 0),
  );
  for (const slice of rejects) {
    expect(planNumberingSequencePaste(current, slice).kind).toBe("reject");
    expect(current.doc.eq(initial.doc)).toBe(true);
  }
});

test("合并端段落属性冲突拒绝，内部段落属性与marks保留", () => {
  const initial = state();
  const slice = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice;
  const source = slice.content.firstChild!;
  const current = select(initial, "丁后续", 1);
  for (const index of [0, 1, 2]) {
    const children = [...source.content.content],
      item = children[index],
      paragraph = item.firstChild!;
    children[index] = item.copy(
      Fragment.from(paragraph.type.create({ ...paragraph.attrs, semloEditorLineHeight: "3" }, paragraph.content)),
    );
    const changed = new Slice(Fragment.from(source.copy(Fragment.fromArray(children))), 0, 0);
    const plan = planNumberingSequencePaste(current, changed);
    expect(plan.kind).toBe(index === 1 ? "apply" : "reject");
    if (plan.kind === "apply") {
      expect(plan.transaction.doc.firstChild!.child(5).firstChild!.attrs.semloEditorLineHeight).toBe("3");
      expect(plan.transaction.doc.firstChild!.child(5).firstChild!.firstChild!.marks[0].type.name).toBe("italic");
    }
  }
});

test("目标原重启字段保留在首项，新成员只继承目标ID并清重启", () => {
  const initial = state();
  const slice = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice;
  const current = select(initial, "乙中段", 1);
  const plan = planNumberingSequencePaste(current, slice);
  expect(plan.kind).toBe("apply");
  if (plan.kind !== "apply") throw new Error(plan.reason);
  const list = plan.transaction.doc.firstChild!;
  expect(list.content.content.slice(2, 5).map((item) => item.textContent)).toEqual(["乙开头", "乙中段", "丙中段"]);
  expect(list.content.content.slice(2, 5).map((item) => item.attrs.semloEditorListRestart)).toEqual([
    true,
    false,
    false,
  ]);
  expect(list.content.content.slice(2, 5).map((item) => item.attrs.semloEditorListSequence)).toEqual(["B", "B", "B"]);
  expect(list.attrs).toEqual(initial.doc.firstChild!.attrs);
});

test("自定义多级decimal与mixed显式decimal不可混淆，缺省/mixed才等价", () => {
  const initial = state();
  const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice.content
    .firstChild!;
  const numbered = sequencePasteContent();
  numbered.content![0].attrs!.semloEditorOrderedStyle = "decimal";
  const target = select(state(numbered), "丁后续", 1);
  const explicit = source.type.create({ ...source.attrs, semloEditorOrderedStyle: "mixed", type: "1" }, source.content);
  expect(planNumberingSequencePaste(target, new Slice(Fragment.from(explicit), 0, 0)).kind).toBe("reject");
  const unknown = source.type.create(
    { ...source.attrs, semloEditorOrderedStyle: "decimal", type: "future" },
    source.content,
  );
  expect(planNumberingSequencePaste(target, new Slice(Fragment.from(unknown), 0, 0)).kind).toBe("reject");
  const unstyled = source.type.create({ ...source.attrs, semloEditorOrderedStyle: null }, source.content);
  expect(planNumberingSequencePaste(select(initial, "丁后续", 1), new Slice(Fragment.from(unstyled), 0, 0)).kind).toBe(
    "apply",
  );
  for (const style of ["decimal", "chinese"]) {
    const content = sequencePasteContent();
    content.content![0].attrs!.semloEditorOrderedStyle = style;
    const same = state(content);
    const slice = projectNumberingSequenceClipboard(select(same, "甲开头", 1, "丙结尾", 1))!.slice;
    expect(planNumberingSequencePaste(select(same, "丁后续", 1), slice).kind).toBe("apply");
  }
});

for (const [name, first, last, expected, ids, values, reverse] of [
  [
    "同一重新编号序列",
    "乙中段",
    "丁后续",
    ["父", "甲开头", "乙开头", "乙中段", "丙后续"],
    ["R", "A", "B", "B", "B"],
    [1, 1, 1, 2, 3],
    false,
  ],
  [
    "跨重新编号边界",
    "甲开头",
    "乙中段",
    ["父", "甲开头", "乙中段", "丙中段", "丙结尾", "丁后续"],
    ["R", "A", "A", "A", "B", "B"],
    [1, 1, 2, 3, 1, 2],
    false,
  ],
  [
    "跨编号边界的反向选区",
    "甲开头",
    "乙中段",
    ["父", "甲开头", "乙中段", "丙中段", "丙结尾", "丁后续"],
    ["R", "A", "A", "A", "B", "B"],
    [1, 1, 2, 3, 1, 2],
    true,
  ],
] as const)
  test(`跨项替换：${name}保留首项身份、剩余编号及撤销选区`, () => {
    const initial = state();
    const source = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!;
    let current = select(initial, first, 1, last, 1);
    if (reverse)
      current = current.apply(
        current.tr.setSelection(TextSelection.create(current.doc, current.selection.to, current.selection.from)),
      );
    const before = current.doc;
    const selection = { anchor: current.selection.anchor, head: current.selection.head };
    const plan = planNumberingSequencePaste(current, source.slice);
    expect(plan.kind).toBe("apply");
    if (plan.kind !== "apply") throw new Error(plan.reason);
    current = current.apply(markSequenceOperation(plan.transaction));
    const list = current.doc.firstChild!;
    expect(list.content.content.map((item) => item.textContent)).toEqual(expected);
    expect(list.content.content.map((item) => item.attrs.semloEditorListSequence)).toEqual(ids);
    const resolved = resolveListNumbering(list);
    expect(resolved.ok && resolved.value.values).toEqual(values);
    expect(list.attrs).toEqual(before.firstChild!.attrs);
    const after = current.doc;
    expect(undo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
    expect({ anchor: current.selection.anchor, head: current.selection.head }).toEqual(selection);
    expect(redo(current, (tr) => (current = current.apply(tr)))).toBe(true);
    expect(current.doc.eq(after)).toBe(true);
  });

test("非TextSelection、带子项、物理嵌套或legacy目标保持", () => {
  const initial = state();
  const slice = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "丙结尾", 1))!.slice;
  const candidates = [
    select(initial, "父", 0),
    select(initial, "父", 1, "甲开头", 1),
    initial.apply(initial.tr.setSelection(new AllSelection(initial.doc))),
    initial.apply(initial.tr.setSelection(NodeSelection.create(initial.doc, 0))),
  ];
  const nested = { type: "doc", content: [{ type: "blockquote", content: sequencePasteContent().content }] };
  candidates.push(select(state(nested), "丁后续", 1));
  const legacy = sequencePasteContent();
  delete legacy.content![0].attrs!.semloEditorListSequences;
  legacy.content![0].content!.forEach((item) => delete item.attrs!.semloEditorListSequence);
  candidates.push(select(state(legacy), "丁后续", 1));
  for (const current of candidates) {
    expect(planNumberingSequencePaste(current, slice).kind).toBe("reject");
    expect(planNumberingSequencePlainPaste(current, plainLines("一", "二")).kind).toBe("reject");
  }
});

test("跨项端点或中间段落格式不兼容时拒绝并保留原文", () => {
  const content = sequencePasteContent();
  content.content![0].content![3].content![0].attrs!.semloEditorLineHeight = "1.5";
  const initial = state(content);
  const slice = projectNumberingSequenceClipboard(select(initial, "甲开头", 1, "乙中段", 1))!.slice;
  const target = select(initial, "乙中段", 1, "丁后续", 1);
  expect(planNumberingSequencePaste(target, slice).kind).toBe("reject");
  expect(planNumberingSequencePlainPaste(target, plainLines("一", "二")).kind).toBe("reject");
  expect(target.doc.eq(initial.doc)).toBe(true);
});
