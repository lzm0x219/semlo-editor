import { runInNewContext } from "node:vm";

import { expect, test } from "@rstest/core";

import {
  changeNumberingSequence,
  materializeNumberingSequences,
  resolveNumberingSequences,
  reorderNumberingSequenceItems,
  type NumberingSequenceInput,
  type NumberingSequenceResult,
} from "../../../../packages/core/src/features/list/numbering-sequences";

function accepted<T>(result: NumberingSequenceResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

const threeChildren: NumberingSequenceInput = {
  start: 1,
  items: [
    { level: 0, leaf: false },
    { level: 1, leaf: true },
    { level: 1, restart: true, leaf: true },
    { level: 1, leaf: true },
  ],
};

test("编号序列：三子项的重启乙移到丙后，丙乙按自身序列重新计数", () => {
  const before = structuredClone(threeChildren);
  const moved = accepted(reorderNumberingSequenceItems(threeChildren, 2, 3));
  expect(moved.order).toEqual([0, 1, 3, 2]);
  expect(moved.values).toEqual([1, 1, 1, 2]);
  expect(moved.sequenceIds[2]).toBe(moved.sequenceIds[3]);
  expect(threeChildren).toEqual(before);
});

test("编号序列：三子项的重启乙移到甲前，丙仍继续乙的序列", () => {
  const moved = accepted(reorderNumberingSequenceItems(threeChildren, 2, 1));
  expect(moved.order).toEqual([0, 2, 1, 3]);
  expect(moved.values).toEqual([1, 1, 1, 2]);
  expect(moved.sequenceIds[1]).toBe(moved.sequenceIds[3]);
});

const fiveChildren: NumberingSequenceInput = {
  start: 1,
  items: [
    { level: 0, leaf: false },
    { level: 1, leaf: true },
    { level: 1, restart: true, leaf: true },
    { level: 1, leaf: true },
    { level: 1, restart: true, leaf: true },
    { level: 1, leaf: true },
  ],
};

test("编号序列：五子项普通甲移到末尾，各序列独立计数", () => {
  const moved = accepted(reorderNumberingSequenceItems(fiveChildren, 1, 5));
  expect(moved.order).toEqual([0, 2, 3, 4, 5, 1]);
  expect(moved.values).toEqual([1, 1, 2, 1, 2, 1]);
});

test("编号序列：重启丁移到甲前，丁和末尾戊仍为同序列的 a/b", () => {
  const moved = accepted(reorderNumberingSequenceItems(fiveChildren, 4, 1));
  expect(moved.order).toEqual([0, 4, 1, 2, 3, 5]);
  expect(moved.values).toEqual([1, 1, 1, 1, 2, 2]);
  expect(moved.sequenceIds[1]).toBe(moved.sequenceIds[5]);
});

test("编号序列：旧内容只读取而不物化，复杂起点和层级保留旧语义", () => {
  const input: NumberingSequenceInput = {
    start: 5,
    levelStarts: { 1: 4, 2: 6 },
    items: [0, 1, 2, 1, 2, 0, 1].map((level, index) => ({ level, restart: index === 3, leaf: false })),
  };
  const before = structuredClone(input);
  const read = accepted(resolveNumberingSequences(input));
  expect(read).toEqual({
    kind: "legacy",
    values: [5, 4, 6, 1, 1, 6, 1],
    registry: null,
    sequenceIds: Array(7).fill(null),
    controls: null,
  });
  const materialized = accepted(materializeNumberingSequences(input));
  expect(materialized.values).toEqual([5, 4, 6, 1, 1, 6, 1]);
  expect(
    accepted(
      resolveNumberingSequences({
        ...input,
        registry: materialized.registry,
        items: input.items.map((item, index) => ({ ...item, sequenceId: materialized.sequenceIds[index] })),
      }),
    ).values,
  ).toEqual([5, 4, 6, 1, 1, 6, 1]);
  expect(input).toEqual(before);
});

const versionOne: NumberingSequenceInput = {
  registry: {
    version: 1,
    sequences: [
      { id: "root", start: 1, origin: "initial" },
      { id: "A", start: 1, origin: "initial" },
      { id: "B", start: 1, origin: "restart" },
    ],
  },
  items: [
    { level: 0, sequenceId: "root", leaf: false },
    { level: 1, sequenceId: "A", leaf: true },
    { level: 1, sequenceId: "B", leaf: true },
    { level: 1, sequenceId: "B", leaf: true },
  ],
};

test("编号序列：未知版本拒绝读取，不能伪装为 v1 或旧编号", () => {
  expect(
    resolveNumberingSequences({
      ...versionOne,
      registry: {
        version: 2,
        sequences: [
          { id: "root", start: 1, origin: "initial" },
          { id: "A", start: 1, origin: "initial" },
          { id: "B", start: 1, origin: "restart" },
        ],
      },
    }),
  ).toEqual({ ok: false, reason: "unsupported-version" });
});

test("编号序列：v1 是唯一计数依据，两个相同局部 ID 的列表不会共享 counter", () => {
  const input: NumberingSequenceInput = {
    ...versionOne,
    start: 99,
    levelStarts: { 1: 42 },
    items: versionOne.items.map((item) => ({ ...item, restart: true })),
  };
  const first = accepted(resolveNumberingSequences(input));
  const second = accepted(resolveNumberingSequences(structuredClone(input)));
  expect(first.values).toEqual([1, 1, 1, 2]);
  expect(second.values).toEqual([1, 1, 1, 2]);
  first.values[0] = 30;
  expect(accepted(resolveNumberingSequences(input)).values).toEqual([1, 1, 1, 2]);
});

for (const [name, input, reason] of [
  [
    "重复的序列定义",
    {
      ...versionOne,
      registry: {
        version: 1,
        sequences: [
          { id: "root", start: 1, origin: "initial" },
          { id: "A", start: 1, origin: "initial" },
          { id: "B", start: 1, origin: "restart" },
          { id: "B", start: 2, origin: "restart" },
        ],
      },
    },
    "duplicate-sequence",
  ],
  [
    "成员引用不存在的序列",
    {
      ...versionOne,
      items: versionOne.items.map((item, index) => (index === 3 ? { ...item, sequenceId: "missing" } : item)),
    },
    "missing-sequence",
  ],
  [
    "成员缺少局部 ID",
    {
      ...versionOne,
      items: versionOne.items.map((item, index) => (index === 3 ? { ...item, sequenceId: null } : item)),
    },
    "missing-sequence",
  ],
  ["只有成员 ID 而没有 registry", { ...versionOne, registry: undefined }, "missing-sequence"],
] as const) {
  test(`编号序列：拒绝${name}而不静默改成旧编号`, () => {
    expect(resolveNumberingSequences(input)).toEqual({ ok: false, reason });
  });
}

test("编号序列：同一个 ID 不得跨逻辑父项或层级共享计数", () => {
  const registry = {
    version: 1,
    sequences: [
      { id: "roots", start: 1, origin: "initial" },
      { id: "child", start: 1, origin: "initial" },
    ],
  };
  expect(
    resolveNumberingSequences({
      registry,
      items: [
        { level: 0, sequenceId: "roots", leaf: false },
        { level: 1, sequenceId: "child", leaf: true },
        { level: 0, sequenceId: "roots", leaf: false },
        { level: 1, sequenceId: "child", leaf: true },
      ],
    }),
  ).toEqual({ ok: false, reason: "scope-mismatch" });
  expect(
    resolveNumberingSequences({
      registry,
      items: [
        { level: 0, sequenceId: "roots", leaf: false },
        { level: 1, sequenceId: "roots", leaf: true },
      ],
    }),
  ).toEqual({ ok: false, reason: "scope-mismatch" });
});

for (const [name, registry] of [
  ["非对象", false],
  ["数组", []],
  ["缺少序列表", { version: 1 }],
  ["空序列表", { version: 1, sequences: [] }],
  ["未声明 registry 字段", { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }], future: true }],
  ["未声明序列字段", { version: 1, sequences: [{ id: "A", start: 1, origin: "initial", future: true }] }],
  ["缺少来源", { version: 1, sequences: [{ id: "A", start: 1 }] }],
  ["未知来源", { version: 1, sequences: [{ id: "A", start: 1, origin: "unknown" }] }],
  ["空 ID", { version: 1, sequences: [{ id: "", start: 1, origin: "initial" }] }],
  ["超长 ID", { version: 1, sequences: [{ id: "A".repeat(65), start: 1, origin: "initial" }] }],
] as const) {
  test(`编号序列：${name}不能静默归一化成可保存 registry`, () => {
    expect(resolveNumberingSequences({ ...versionOne, registry })).toEqual({ ok: false, reason: "invalid-registry" });
  });
}

test("编号序列：拒绝 accessor、稀疏数组、隐藏字段和失效 Proxy，不执行 getter", () => {
  let reads = 0;
  const getter = () => {
    reads++;
    return 1;
  };
  const badVersion = Object.defineProperty({ sequences: [{ id: "A", start: 1, origin: "initial" }] }, "version", {
    enumerable: true,
    get: getter,
  });
  const badStart = {
    version: 1,
    sequences: [Object.defineProperty({ id: "A", origin: "initial" }, "start", { enumerable: true, get: getter })],
  };
  const hidden = Object.defineProperty(
    { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
    "hidden",
    { value: true },
  );
  const sparse = { version: 1, sequences: Array(1) };
  const proxy = Proxy.revocable({ version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] }, {});
  proxy.revoke();
  for (const registry of [badVersion, badStart, hidden, sparse, proxy.proxy]) {
    expect(resolveNumberingSequences({ ...versionOne, registry })).toEqual({ ok: false, reason: "invalid-registry" });
  }
  expect(reads).toBe(0);
});

test("编号序列：registry 容量 4096 是可保存边界，超出时不截断", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: Array.from({ length: 4096 }, (_, index) => ({
        id: `S${index}`,
        start: 1,
        origin: index === 0 ? "initial" : "restart",
      })),
    },
    items: Array.from({ length: 4096 }, (_, index) => ({ level: 0, sequenceId: `S${index}`, leaf: true })),
  };
  expect(accepted(resolveNumberingSequences(input)).values).toHaveLength(4096);
  expect(
    resolveNumberingSequences({
      ...input,
      registry: {
        version: 1,
        sequences: Array.from({ length: 4097 }, (_, index) => ({
          id: `S${index}`,
          start: 1,
          origin: index === 0 ? "initial" : "restart",
        })),
      },
    }),
  ).toEqual({ ok: false, reason: "capacity-exceeded" });
});

for (const start of [NaN, Infinity, -Infinity, -2147483649, 2147483648, 1.5, "1", null, Symbol("start")]) {
  test(`编号序列：拒绝不可保存的起点 ${String(start)}`, () => {
    expect(
      resolveNumberingSequences({
        registry: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
        items: [{ level: 0, sequenceId: "A", leaf: true }],
      }),
    ).toEqual({ ok: false, reason: "invalid-start" });
  });
}

test("编号序列：起点支持有符号 32 位边界，但序列递增溢出不得饱和后保存", () => {
  for (const start of [-2147483648, 2147483647]) {
    expect(
      accepted(
        resolveNumberingSequences({
          registry: { version: 1, sequences: [{ id: "A", start, origin: "initial" }] },
          items: [{ level: 0, sequenceId: "A", leaf: true }],
        }),
      ).values,
    ).toEqual([start]);
  }
  expect(
    resolveNumberingSequences({
      registry: { version: 1, sequences: [{ id: "A", start: 2147483647, origin: "initial" }] },
      items: [
        { level: 0, sequenceId: "A", leaf: true },
        { level: 0, sequenceId: "A", leaf: true },
      ],
    }),
  ).toEqual({ ok: false, reason: "invalid-start" });
});

test("编号序列：旧编号的饱和结果仍可读取，但不能物化为溢出的新序列", () => {
  const input: NumberingSequenceInput = {
    start: 2147483647,
    items: [
      { level: 0, leaf: true },
      { level: 0, leaf: true },
    ],
  };
  expect(accepted(resolveNumberingSequences(input)).values).toEqual([2147483647, 2147483647]);
  expect(materializeNumberingSequences(input)).toEqual({ ok: false, reason: "invalid-start" });
});

test("编号序列：物化超出序列容量或旧输入不能无损解释时拒绝，不改旧内容", () => {
  const many: NumberingSequenceInput = {
    items: Array.from({ length: 4097 }, () => ({ level: 0, restart: true, leaf: true })),
  };
  expect(materializeNumberingSequences(many)).toEqual({ ok: false, reason: "capacity-exceeded" });
  for (const input of [
    { ...threeChildren, start: "invalid" },
    { ...threeChildren, levelStarts: { unknown: 1 } },
    { items: [{ level: "bad", leaf: true }] },
    { items: [{ level: 0, restart: "true", leaf: true }] },
    { items: [] },
  ]) {
    const before = structuredClone(input);
    expect(materializeNumberingSequences(input)).toEqual({ ok: false, reason: "unsupported-legacy" });
    expect(input).toEqual(before);
  }
});

test("编号序列：跨父、跨层及有后代的移动在物化前拒绝", () => {
  const crossParent: NumberingSequenceInput = {
    items: [
      { level: 0, leaf: false },
      { level: 1, leaf: true },
      { level: 0, leaf: false },
      { level: 1, leaf: true },
    ],
  };
  expect(reorderNumberingSequenceItems(crossParent, 1, 3)).toEqual({ ok: false, reason: "unsupported-move" });
  expect(reorderNumberingSequenceItems(threeChildren, 0, 1)).toEqual({ ok: false, reason: "unsupported-move" });
  expect(
    reorderNumberingSequenceItems(
      {
        items: [
          { level: 0, leaf: true },
          { level: 1, leaf: true },
          { level: 0, leaf: true },
        ],
      },
      0,
      2,
    ),
  ).toEqual({ ok: false, reason: "unsupported-move" });
  expect(reorderNumberingSequenceItems(threeChildren, -1, -1)).toEqual({ ok: false, reason: "unsupported-move" });
  expect(reorderNumberingSequenceItems(threeChildren, 2, 2)).toEqual({ ok: false, reason: "no-change" });
  expect(crossParent.registry).toBeUndefined();
});

test("编号序列：ID 长度边界、原型同名 ID 及冻结输入都可独立保存", () => {
  for (const id of ["A".repeat(64), "__proto__"]) {
    const input: NumberingSequenceInput = {
      registry: Object.freeze({
        version: 1,
        sequences: Object.freeze([Object.freeze({ id, start: 7, origin: "initial" })]),
      }),
      items: Object.freeze([Object.freeze({ level: 0, sequenceId: id, leaf: true })]),
    };
    const read = accepted(resolveNumberingSequences(input));
    expect(read.values).toEqual([7]);
    if (read.kind !== "v1") throw new Error("应为 v1");
    read.registry.sequences[0].start = 9;
    expect(accepted(resolveNumberingSequences(input)).values).toEqual([7]);
  }
});

test("编号序列：来自另一个 realm 的普通 JSON 记录仍可读取", () => {
  const registry: unknown = runInNewContext('({ version: 1, sequences: [{ id: "A", start: 4, origin: "initial" }] })');
  expect(
    accepted(
      resolveNumberingSequences({
        registry,
        items: [{ level: 0, sequenceId: "A", leaf: true }],
      }),
    ).values,
  ).toEqual([4]);
});

test("编号序列：v1 成员层级不合法或为空时拒绝，不借旧格式回退掩盖", () => {
  for (const level of [-1, 9, NaN, "bad", Symbol("level")]) {
    expect(
      resolveNumberingSequences({
        registry: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
        items: [{ level, sequenceId: "A", leaf: true }],
      }),
    ).toEqual({ ok: false, reason: "invalid-member" });
  }
  expect(
    resolveNumberingSequences({
      registry: { version: 1, sequences: [{ id: "A", start: 1, origin: "initial" }] },
      items: [],
    }),
  ).toEqual({ ok: false, reason: "invalid-member" });
});

test("编号序列：未使用的合法定义可保留，以免删除末成员时丢失其余序列", () => {
  const read = accepted(
    resolveNumberingSequences({
      registry: {
        version: 1,
        sequences: [
          { id: "A", start: 1, origin: "initial" },
          { id: "unused", start: 7, origin: "initial" },
        ],
      },
      items: [
        { level: 0, sequenceId: "A", leaf: true },
        { level: 0, sequenceId: "A", leaf: true },
      ],
    }),
  );
  expect(read.values).toEqual([1, 2]);
  expect(read.registry).toEqual({
    version: 1,
    sequences: [
      { id: "A", start: 1, origin: "initial" },
      { id: "unused", start: 7, origin: "initial" },
    ],
  });
});

test("编号序列：显式重启后缀与继续合并会跳过夹在中间的乙丙序列", () => {
  const interleaved: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "A", start: 1, origin: "initial" },
        { id: "B", start: 1, origin: "restart" },
        { id: "C", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: false },
      { level: 1, sequenceId: "C", leaf: true },
      { level: 1, sequenceId: "A", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "C", leaf: true },
    ],
  };
  const restarted = accepted(changeNumberingSequence(interleaved, { kind: "restart", index: 2 }));
  expect(restarted.values).toEqual([1, 1, 1, 1, 2, 2]);
  expect(restarted.sequenceIds[2]).not.toBe("A");
  const merged = accepted(
    changeNumberingSequence(
      {
        ...interleaved,
        registry: restarted.registry,
        items: interleaved.items.map((item, index) => ({ ...item, sequenceId: restarted.sequenceIds[index] })),
      },
      { kind: "continue", index: 2 },
    ),
  );
  expect(merged.values).toEqual([1, 1, 2, 1, 2, 3]);
  expect(merged.sequenceIds).toEqual(["root", "C", "C", "B", "B", "C"]);

  const inserted: NumberingSequenceInput = {
    registry: merged.registry,
    items: [
      { level: 0, sequenceId: "root", leaf: false },
      { level: 1, sequenceId: "C", leaf: true },
      { level: 1, sequenceId: "C", leaf: true },
      { level: 1, sequenceId: "C", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "C", leaf: true },
    ],
  };
  expect(accepted(resolveNumberingSequences(inserted)).values).toEqual([1, 1, 2, 3, 1, 2, 4]);
  expect(
    accepted(resolveNumberingSequences({ ...inserted, items: inserted.items.filter((_, index) => index !== 2) }))
      .values,
  ).toEqual([1, 1, 2, 1, 2, 3]);
  const split = accepted(changeNumberingSequence(inserted, { kind: "restart", index: 3 }));
  expect(split.values).toEqual([1, 1, 2, 1, 1, 2, 2]);
  expect(split.sequenceIds[4]).toBe("B");
  expect(split.sequenceIds[5]).toBe("B");
  const continued = accepted(
    changeNumberingSequence(
      {
        ...inserted,
        registry: split.registry,
        items: inserted.items.map((item, index) => ({ ...item, sequenceId: split.sequenceIds[index] })),
      },
      { kind: "continue", index: 3 },
    ),
  );
  expect(continued.values).toEqual([1, 1, 2, 3, 1, 2, 4]);
});

test("编号序列：显式操作不物化旧内容，不跨父层或改写带后代项", () => {
  expect(changeNumberingSequence(threeChildren, { kind: "restart", index: 2 })).toEqual({
    ok: false,
    reason: "unsupported-legacy",
  });
  expect(changeNumberingSequence(versionOne, { kind: "restart", index: 0 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  expect(changeNumberingSequence(versionOne, { kind: "continue", index: 1 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  expect(changeNumberingSequence(versionOne, { kind: "continue", index: 3 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  expect(changeNumberingSequence(versionOne, { kind: "restart", index: 20 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  expect(
    changeNumberingSequence(
      {
        ...versionOne,
        items: versionOne.items.map((item, index) => (index === 3 ? { ...item, leaf: false } : item)),
      },
      { kind: "restart", index: 2 },
    ),
  ).toEqual({ ok: false, reason: "unsupported-change" });
});

test("编号序列：新后缀 ID 不碰撞已有局部定义，先前成员继续原序列", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "root", start: 1, origin: "initial" },
        { id: "s0", start: 1, origin: "initial" },
        { id: "s1", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "root", leaf: false },
      { level: 1, sequenceId: "s0", leaf: true },
      { level: 1, sequenceId: "s1", leaf: true },
      { level: 1, sequenceId: "s1", leaf: true },
    ],
  };
  const restarted = accepted(changeNumberingSequence(input, { kind: "restart", index: 3 }));
  expect(restarted.values).toEqual([1, 1, 1, 1]);
  expect(restarted.sequenceIds.slice(0, 3)).toEqual(["root", "s0", "s1"]);
  expect(["root", "s0", "s1"]).not.toContain(restarted.sequenceIds[3]);
});

test("编号序列：菜单资格跟随显式重启序列的当前首成员，不跟随旧源项 bool", () => {
  const moved = accepted(reorderNumberingSequenceItems(threeChildren, 2, 3));
  expect(moved.controls).toEqual([
    { restart: false, continue: false },
    { restart: true, continue: false },
    { restart: false, continue: true },
    { restart: true, continue: false },
  ]);
  const input: NumberingSequenceInput = {
    ...threeChildren,
    registry: moved.registry,
    items: moved.order.map((original, index) => ({
      ...threeChildren.items[original],
      sequenceId: moved.sequenceIds[index],
    })),
  };
  expect(changeNumberingSequence(input, { kind: "restart", index: 2 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  expect(changeNumberingSequence(input, { kind: "continue", index: 3 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  const merged = accepted(changeNumberingSequence(input, { kind: "continue", index: 2 }));
  expect(merged.values).toEqual([1, 1, 2, 3]);
  expect(merged.sequenceIds[1]).toBe(merged.sequenceIds[3]);
});

test("编号序列：初始序列即使前面已有同层项也不能继续，手动重启后才可继续", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "R", start: 1, origin: "initial" },
        { id: "A", start: 1, origin: "initial" },
        { id: "B", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "R", leaf: false },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 1, sequenceId: "A", leaf: true },
      { level: 1, sequenceId: "B", leaf: true },
    ],
  };
  const read = accepted(resolveNumberingSequences(input));
  expect(read.controls?.[2]).toEqual({ restart: true, continue: false });
  expect(changeNumberingSequence(input, { kind: "continue", index: 2 })).toEqual({
    ok: false,
    reason: "unsupported-change",
  });
  const restarted = accepted(changeNumberingSequence(input, { kind: "restart", index: 2 }));
  expect(restarted.controls[2]).toEqual({ restart: false, continue: true });
});

test("编号序列：无前驱的首子项重启后仍可继续，继续只恢复 initial 来源并保留编号", () => {
  const legacy: NumberingSequenceInput = {
    items: [
      { level: 0, leaf: false },
      { level: 1, leaf: true },
      { level: 1, leaf: true },
      { level: 1, leaf: true },
    ],
  };
  const first = accepted(materializeNumberingSequences(legacy));
  const input: NumberingSequenceInput = {
    ...legacy,
    registry: first.registry,
    items: legacy.items.map((item, index) => ({ ...item, sequenceId: first.sequenceIds[index] })),
  };
  expect(first.values).toEqual([1, 1, 2, 3]);
  expect(first.controls[1]).toEqual({ restart: true, continue: false });
  const restarted = accepted(changeNumberingSequence(input, { kind: "restart", index: 1 }));
  expect(restarted.values).toEqual([1, 1, 2, 3]);
  expect(restarted.controls[1]).toEqual({ restart: false, continue: true });
  const restartedInput: NumberingSequenceInput = {
    ...input,
    registry: restarted.registry,
    items: input.items.map((item, index) => ({ ...item, sequenceId: restarted.sequenceIds[index] })),
  };
  const continued = accepted(changeNumberingSequence(restartedInput, { kind: "continue", index: 1 }));
  expect(continued.values).toEqual([1, 1, 2, 3]);
  expect(continued.controls[1]).toEqual({ restart: true, continue: false });
  expect(continued.registry).not.toEqual(restarted.registry);
  const reloaded = accepted(
    resolveNumberingSequences(
      JSON.parse(
        JSON.stringify({
          ...restartedInput,
          registry: continued.registry,
          items: input.items.map((item, index) => ({ ...item, sequenceId: continued.sequenceIds[index] })),
        }),
      ) as NumberingSequenceInput,
    ),
  );
  expect(reloaded.values).toEqual([1, 1, 2, 3]);
  expect(reloaded.controls?.[1]).toEqual({ restart: true, continue: false });
});

test("编号序列：前置显式序列继续时合并到后面的唯一初始序列，不按定义数组顺序选目标", () => {
  const definitions = [
    { id: "B", start: 1, origin: "restart" },
    { id: "R", start: 1, origin: "initial" },
    { id: "A", start: 1, origin: "initial" },
  ];
  for (const sequences of [definitions, [...definitions].reverse()]) {
    const input: NumberingSequenceInput = JSON.parse(
      JSON.stringify({
        registry: { version: 1, sequences },
        items: [
          { level: 0, sequenceId: "R", leaf: false },
          { level: 1, sequenceId: "B", leaf: true },
          { level: 1, sequenceId: "A", leaf: true },
          { level: 1, sequenceId: "B", leaf: true },
        ],
      }),
    ) as NumberingSequenceInput;
    const before = structuredClone(input);
    const continued = accepted(changeNumberingSequence(input, { kind: "continue", index: 1 }));
    expect(continued.values.slice(1)).toEqual([1, 2, 3]);
    expect(continued.sequenceIds).toEqual(["R", "A", "A", "A"]);
    expect(continued.registry.sequences.find((sequence) => sequence.id === "A")).toEqual({
      id: "A",
      start: 1,
      origin: "initial",
    });
    expect(continued.registry.sequences.some((sequence) => sequence.id === "B")).toBe(false);
    expect(continued.controls[1]).toEqual({ restart: true, continue: false });
    expect(input).toEqual(before);
  }
});

test("编号序列：同 scope 的多个活跃初始序列明确拒绝，未引用定义不参与目标选择", () => {
  const registry = {
    version: 1,
    sequences: [
      { id: "R", start: 1, origin: "initial" },
      { id: "A", start: 1, origin: "initial" },
      { id: "C", start: 1, origin: "initial" },
    ],
  };
  const input: NumberingSequenceInput = {
    registry,
    items: [
      { level: 0, sequenceId: "R", leaf: false },
      { level: 1, sequenceId: "A", leaf: true },
      { level: 1, sequenceId: "C", leaf: true },
    ],
  };
  expect(resolveNumberingSequences(input)).toEqual({ ok: false, reason: "initial-conflict" });
  expect(
    resolveNumberingSequences({ ...input, registry: { ...registry, sequences: [...registry.sequences].reverse() } }),
  ).toEqual({ ok: false, reason: "initial-conflict" });
  expect(accepted(resolveNumberingSequences({ ...input, items: input.items.slice(0, 2) })).values).toEqual([1, 1]);
});

test("编号序列：没有本 scope 初始序列时只恢复来源，不合并其他父项的初始序列", () => {
  const input: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "R", start: 1, origin: "initial" },
        { id: "A", start: 1, origin: "initial" },
        { id: "B", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "R", leaf: false },
      { level: 1, sequenceId: "B", leaf: true },
      { level: 0, sequenceId: "R", leaf: false },
      { level: 1, sequenceId: "A", leaf: true },
    ],
  };
  const continued = accepted(changeNumberingSequence(input, { kind: "continue", index: 1 }));
  expect(continued.sequenceIds).toEqual(["R", "B", "R", "A"]);
  expect(continued.values).toEqual([1, 1, 2, 1]);
  expect(continued.registry.sequences.find((sequence) => sequence.id === "B")?.origin).toBe("initial");
});

test("编号序列：拆出过多序列或合并导致数值溢出时保留输入", () => {
  const full: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: Array.from({ length: 4096 }, (_, index) => ({
        id: `S${index}`,
        start: 1,
        origin: index === 0 ? "initial" : "restart",
      })),
    },
    items: [
      { level: 0, sequenceId: "S0", leaf: true },
      ...Array.from({ length: 4096 }, (_, index) => ({ level: 0, sequenceId: `S${index}`, leaf: true })),
    ],
  };
  const before = structuredClone(full);
  expect(changeNumberingSequence(full, { kind: "restart", index: 1 })).toEqual({
    ok: false,
    reason: "capacity-exceeded",
  });
  expect(full).toEqual(before);
  const overflow: NumberingSequenceInput = {
    registry: {
      version: 1,
      sequences: [
        { id: "A", start: 2147483647, origin: "initial" },
        { id: "B", start: 1, origin: "restart" },
      ],
    },
    items: [
      { level: 0, sequenceId: "A", leaf: true },
      { level: 0, sequenceId: "B", leaf: true },
    ],
  };
  expect(changeNumberingSequence(overflow, { kind: "continue", index: 1 })).toEqual({
    ok: false,
    reason: "invalid-start",
  });
});
