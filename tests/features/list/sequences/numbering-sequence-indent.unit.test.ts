import { expect, test } from "@rstest/core";

import {
  indentNumberingSequenceItems,
  type NumberingSequenceInput,
} from "../../../../packages/core/src/features/list/numbering-sequences";

const flat: NumberingSequenceInput = {
  registry: { version: 1, sequences: [{ id: "root", start: 1, origin: "initial" }] },
  items: Array.from({ length: 4 }, () => ({ level: 0, sequenceId: "root", leaf: true })),
};

test("同一序列连续项缩进并提升后，分别接入目标层级", () => {
  const initial = structuredClone(flat);
  const indent = indentNumberingSequenceItems(flat, [1, 2], 1);
  expect(indent.ok).toBe(true);
  if (!indent.ok) throw new Error(indent.reason);
  expect(indent.value.levels).toEqual([0, 1, 1, 0]);
  expect(indent.value.values).toEqual([1, 1, 2, 2]);
  expect(indent.value.sequenceIds[1]).toBe(indent.value.sequenceIds[2]);
  expect(indent.value.sequenceIds[1]).not.toBe("root");
  expect(flat).toEqual(initial);

  const outdent = indentNumberingSequenceItems(
    {
      ...flat,
      registry: indent.value.registry,
      items: flat.items.map((item, index) => ({
        ...item,
        level: indent.value.levels[index],
        sequenceId: indent.value.sequenceIds[index],
      })),
    },
    [1, 2],
    -1,
  );
  expect(outdent.ok).toBe(true);
  if (!outdent.ok) throw new Error(outdent.reason);
  expect(outdent.value.levels).toEqual([0, 0, 0, 0]);
  expect(outdent.value.sequenceIds).toEqual(["root", "root", "root", "root"]);
  expect(outdent.value.values).toEqual([1, 2, 3, 4]);
});

test("新建序列避开续接中其他片段的编号身份", () => {
  const result = indentNumberingSequenceItems(flat, [1], 1, new Set(["indent-1", "indent-2"]));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.value.sequenceIds[1]).toBe("indent-3");
  expect(result.value.values).toEqual([1, 1, 2, 3]);
});

test("目标层级已有重启序列时，普通项接续邻近序列", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "child", start: 1, origin: "initial" },
        { id: "restart", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: true },
      { level: 1, sequenceId: "child", leaf: true },
      { level: 1, sequenceId: "restart", leaf: true },
      { level: 1, sequenceId: "restart", leaf: true },
      { level: 0, sequenceId: "root", leaf: true },
    ],
  };
  const result = indentNumberingSequenceItems(input, [4], 1);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.value.sequenceIds).toEqual(["root", "child", "restart", "restart", "restart"]);
  expect(result.value.values).toEqual([1, 1, 1, 2, 3]);
});

test("重启序列的一项移层后保持独立序列，原层级余项不丢失", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "child", start: 1, origin: "initial" },
        { id: "restart", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: true },
      { level: 1, sequenceId: "child", leaf: true },
      { level: 1, sequenceId: "restart", leaf: true },
      { level: 1, sequenceId: "restart", leaf: true },
    ],
  };
  const result = indentNumberingSequenceItems(input, [3], 1);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.value.levels).toEqual([0, 1, 1, 2]);
  expect(result.value.values).toEqual([1, 1, 1, 1]);
  expect(result.value.sequenceIds[2]).toBe("restart");
  expect(result.value.sequenceIds[3]).not.toBe("restart");
  const restored = indentNumberingSequenceItems(
    {
      ...input,
      registry: result.value.registry,
      items: input.items.map((item, index) => ({
        ...item,
        level: result.value.levels[index],
        sequenceId: result.value.sequenceIds[index],
      })),
    },
    [3],
    -1,
  );
  expect(restored.ok).toBe(true);
  if (!restored.ok) throw new Error(restored.reason);
  expect(restored.value.sequenceIds).toEqual(["root", "child", "restart", "restart"]);
  expect(restored.value.values).toEqual([1, 1, 1, 2]);
});

test("未选后代会改变父项时拒绝缩进，避免悄悄改写文档结构", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "child", start: 1, origin: "initial" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: true },
      { level: 0, sequenceId: "root", leaf: true },
      { level: 1, sequenceId: "child", leaf: true },
    ],
  };
  const before = structuredClone(input);
  expect(indentNumberingSequenceItems(input, [1], 1)).toEqual({ ok: false, reason: "unsupported-change" });
  expect(input).toEqual(before);
});

test("拆分交错序列或移走重启首项时保留原编号归属", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "A", start: 1, origin: "initial" },
        { id: "B", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: true },
      { level: 1, sequenceId: "A", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "A", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
    ],
  };
  const before = structuredClone(input);
  expect(indentNumberingSequenceItems(input, [3], 1)).toEqual({ ok: false, reason: "unsupported-change" });
  expect(indentNumberingSequenceItems(input, [2], 1)).toEqual({ ok: false, reason: "unsupported-change" });
  expect(input).toEqual(before);
});
