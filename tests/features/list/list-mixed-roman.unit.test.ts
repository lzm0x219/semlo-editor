import { expect, test } from "@rstest/core";
import { getSchema } from "@tiptap/core";

import { createCheckedJSONDocument } from "../../../packages/core/src/editor/content/parse";
import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import { sequenceListValues } from "../../../packages/core/src/features/list/numbering-sequence-document";
import { OrderedListNumbering } from "../../../packages/core/src/features/list/ordered-numbering";
import { OrderedListStyles } from "../../../packages/core/src/features/list/ordered-style";
import { listOrdinals, orderedListPlainLabels } from "../../../packages/core/src/features/list/ordinals";
import { ParagraphLayout } from "../../../packages/core/src/features/text/paragraph-layout";
import { mixedRomanContent, observedMixedRoman } from "../../fixtures/list/list-mixed-roman-content";

const schema = getSchema([createStarterKitWithCodeFonts([]), ParagraphLayout, OrderedListStyles, OrderedListNumbering]);

test("默认混合Roman按实测1至100项号生成标签且不改数值和原文", () => {
  const doc = createCheckedJSONDocument(mixedRomanContent(), schema);
  const before = doc.toJSON();
  const labels = [...orderedListPlainLabels(doc).values()];
  for (const [value, label] of observedMixedRoman) expect(labels[value - 1]).toBe(`${label}.`);
  const decorations = listOrdinals(doc).find();
  expect(decorations).toHaveLength(100);
  expect(sequenceListValues(doc.firstChild!)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  expect(doc.toJSON()).toEqual(before);
  expect(JSON.stringify(before)).not.toContain("ordered-marker");
});

test("显式i/I及decimal/alpha不采用默认混合Roman字符", () => {
  for (const [type, expected] of [
    ["i", "xiii."],
    ["I", "XIII."],
    ["1", "13."],
    ["a", "m."],
    ["A", "M."],
  ]) {
    const doc = createCheckedJSONDocument(mixedRomanContent(1, 13, type), schema);
    expect([...orderedListPlainLabels(doc).values()]).toEqual([expected]);
  }
});

test("混合循环第三层使用相同字符，其他层级保留decimal/alpha", () => {
  for (const [indent, expected] of [
    [0, "4."],
    [1, "d."],
    [2, "ⅳ."],
    [3, "4."],
    [5, "ⅳ."],
    [8, "ⅳ."],
  ] as const) {
    const doc = createCheckedJSONDocument(mixedRomanContent(1, 4, null, indent), schema);
    expect([...orderedListPlainLabels(doc).values()]).toEqual([expected]);
  }
});

test("100以上按项目规则扩展，Roman范围外回退decimal", () => {
  for (const [start, expected] of [
    [101, "Cⅰ."],
    [444, "CDXLⅳ."],
    [3999, "MMMCMXCⅸ."],
    [0, "0."],
    [4000, "4000."],
  ] as const) {
    const doc = createCheckedJSONDocument(mixedRomanContent(1, start), schema);
    expect([...orderedListPlainLabels(doc).values()]).toEqual([expected]);
  }
});
