import { MAX_INDENT } from "../../shared/indent";
import { deriveOrderedListValues, normalizeOrderedListLevelStarts, validOrderedListStart } from "./numbering-values";

export interface NumberingSequenceItem {
  level: unknown;
  restart?: unknown;
  sequenceId?: unknown;
  leaf: boolean;
}

export interface NumberingSequenceInput {
  /** 调用方从同一个物理列表读取的节点投影，不包含 DOM 或共享计数状态。 */
  items: readonly NumberingSequenceItem[];
  start?: unknown;
  levelStarts?: unknown;
  registry?: unknown;
}

export interface NumberingSequenceRegistry {
  version: 1;
  sequences: Array<{ id: string; start: number; origin: "initial" | "restart" }>;
}

export interface NumberingSequenceControl {
  /** 仅表示序列语义资格；接入仍需保留原有根级位置、只读等上下文保护。 */
  restart: boolean;
  continue: boolean;
}

export type NumberingSequenceFailure =
  | "invalid-registry"
  | "unsupported-version"
  | "capacity-exceeded"
  | "duplicate-sequence"
  | "missing-sequence"
  | "invalid-start"
  | "invalid-member"
  | "scope-mismatch"
  | "initial-conflict"
  | "unsupported-legacy"
  | "unsupported-move"
  | "unsupported-change"
  | "no-change";

export type NumberingSequenceResult<T> = { ok: true; value: T } | { ok: false; reason: NumberingSequenceFailure };

export type ResolvedNumberingSequences =
  | { kind: "legacy"; values: number[]; registry: null; sequenceIds: null[]; controls: null }
  | {
      kind: "v1";
      values: number[];
      registry: NumberingSequenceRegistry;
      sequenceIds: string[];
      controls: NumberingSequenceControl[];
    };

export type MaterializedNumberingSequences = Extract<ResolvedNumberingSequences, { kind: "v1" }>;

export type IndentedNumberingSequences = MaterializedNumberingSequences & { levels: number[] };

const maxSequences = 4096;
const minStart = -2147483648;
const maxStart = 2147483647;
const objectConstructorSource = Function.prototype.toString.call(Object);
type ItemLayout = { levels: number[]; parents: number[] };

function dataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null) {
    // iframe 等其他 realm 的普通 JSON 对象也有效，不能只比较本 realm 的原型身份。
    const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (
      Object.getPrototypeOf(prototype) !== null ||
      !constructor ||
      !("value" in constructor) ||
      typeof constructor.value !== "function" ||
      Function.prototype.toString.call(constructor.value) !== objectConstructorSource
    )
      return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== keys.length) return null;
  const record: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    record[key] = descriptor.value;
  }
  return record;
}

function readRegistry(value: unknown): NumberingSequenceResult<NumberingSequenceRegistry> {
  try {
    const record = dataRecord(value, ["version", "sequences"]);
    if (!record) return { ok: false, reason: "invalid-registry" };
    if (record.version !== 1) return { ok: false, reason: "unsupported-version" };
    const raw = record.sequences;
    if (!Array.isArray(raw) || !raw.length) return { ok: false, reason: "invalid-registry" };
    if (raw.length > maxSequences) return { ok: false, reason: "capacity-exceeded" };
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Object.getOwnPropertySymbols(raw).length || Object.keys(descriptors).length !== raw.length + 1)
      return { ok: false, reason: "invalid-registry" };
    const sequences: NumberingSequenceRegistry["sequences"] = [];
    const ids = new Set<string>();
    for (let index = 0; index < raw.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
        return { ok: false, reason: "invalid-registry" };
      const sequence = dataRecord(descriptor.value, ["id", "start", "origin"]);
      if (
        !sequence ||
        typeof sequence.id !== "string" ||
        !sequence.id.length ||
        sequence.id.length > 64 ||
        (sequence.origin !== "initial" && sequence.origin !== "restart")
      )
        return { ok: false, reason: "invalid-registry" };
      if (ids.has(sequence.id)) return { ok: false, reason: "duplicate-sequence" };
      if (
        typeof sequence.start !== "number" ||
        !Number.isInteger(sequence.start) ||
        sequence.start < minStart ||
        sequence.start > maxStart
      )
        return { ok: false, reason: "invalid-start" };
      ids.add(sequence.id);
      sequences.push({ id: sequence.id, start: sequence.start, origin: sequence.origin });
    }
    return { ok: true, value: { version: 1, sequences } };
  } catch {
    return { ok: false, reason: "invalid-registry" };
  }
}

function itemLayout(items: readonly NumberingSequenceItem[]): ItemLayout | null {
  const levels: number[] = [];
  const parents: number[] = [];
  const stack: number[] = [];
  for (const [index, item] of items.entries()) {
    if (typeof item.level !== "number" && (typeof item.level !== "string" || !/^\d+$/.test(item.level))) return null;
    const level = Number(item.level);
    if (!Number.isInteger(level) || level < 0 || level > MAX_INDENT) return null;
    levels.push(level);
    while (stack.length && levels[stack[stack.length - 1]] >= level) stack.pop();
    parents.push(stack[stack.length - 1] ?? -1);
    stack.push(index);
  }
  return { levels, parents };
}

function leafAt(input: NumberingSequenceInput, layout: ItemLayout, index: number): boolean {
  return input.items[index].leaf === true && !(layout.levels[index + 1] > layout.levels[index]);
}

function sequenceControls(
  input: NumberingSequenceInput,
  layout: ItemLayout,
  sequenceIds: readonly string[],
  registry: NumberingSequenceRegistry,
): NumberingSequenceControl[] {
  const suffixSafe = new Map<string, boolean>();
  const eligible: boolean[] = [];
  for (let index = sequenceIds.length - 1; index >= 0; index--) {
    const id = sequenceIds[index];
    const safe = (suffixSafe.get(id) ?? true) && leafAt(input, layout, index);
    suffixSafe.set(id, safe);
    eligible[index] = safe;
  }
  const origins = new Map(registry.sequences.map((sequence) => [sequence.id, sequence.origin]));
  const first = new Set<string>();
  const previousAtScope = new Map<string, number>();
  return sequenceIds.map((id, index) => {
    const explicitFirst = !first.has(id) && origins.get(id) === "restart";
    const scope = `${layout.parents[index]}:${layout.levels[index]}`;
    const previous = previousAtScope.get(scope);
    first.add(id);
    previousAtScope.set(scope, index);
    return {
      restart: eligible[index] && !explicitFirst,
      continue: eligible[index] && explicitFirst && (previous === undefined || leafAt(input, layout, previous)),
    };
  });
}

/** 只校验和派生；旧输入没有新字段时保持旧语义，不生成任何身份。 */
export function resolveNumberingSequences(
  input: NumberingSequenceInput,
): NumberingSequenceResult<ResolvedNumberingSequences> {
  if (input.registry == null) {
    if (input.items.some((item) => item.sequenceId != null)) return { ok: false, reason: "missing-sequence" };
    return {
      ok: true,
      value: {
        kind: "legacy",
        values: deriveOrderedListValues(
          input.items.map((item) => item.level),
          input.start ?? 1,
          input.levelStarts,
          input.items.map((item) => item.restart),
        ),
        registry: null,
        sequenceIds: input.items.map(() => null),
        controls: null,
      },
    };
  }
  const decoded = readRegistry(input.registry);
  if (!decoded.ok) return decoded;
  const registry = decoded.value;
  const starts = new Map(registry.sequences.map((sequence) => [sequence.id, sequence.start]));
  const layout = itemLayout(input.items);
  if (!layout || !input.items.length) return { ok: false, reason: "invalid-member" };
  const scopes = new Map<string, { level: number; parent: number }>();
  const sequenceIds: string[] = [];
  for (const [index, item] of input.items.entries()) {
    if (typeof item.sequenceId !== "string" || !starts.has(item.sequenceId))
      return { ok: false, reason: "missing-sequence" };
    const id = item.sequenceId;
    const scope = scopes.get(id);
    if (scope && (scope.level !== layout.levels[index] || scope.parent !== layout.parents[index]))
      return { ok: false, reason: "scope-mismatch" };
    scopes.set(id, { level: layout.levels[index], parent: layout.parents[index] });
    sequenceIds.push(id);
  }
  const initialAtScope = new Map<string, string>();
  for (const sequence of registry.sequences) {
    const scope = scopes.get(sequence.id);
    // 未引用定义没有当前作用范围，不能拿它猜测“继续编号”的目标。
    if (sequence.origin !== "initial" || !scope) continue;
    const key = `${scope.parent}:${scope.level}`;
    if (initialAtScope.has(key)) return { ok: false, reason: "initial-conflict" };
    initialAtScope.set(key, sequence.id);
  }
  const counters = new Map<string, number>();
  const values: number[] = [];
  for (const id of sequenceIds) {
    const previous = counters.get(id);
    const value = previous === undefined ? starts.get(id) : previous + 1;
    if (value === undefined || value > maxStart) return { ok: false, reason: "invalid-start" };
    counters.set(id, value);
    values.push(value);
  }
  const controls = sequenceControls(input, layout, sequenceIds, registry);
  return { ok: true, value: { kind: "v1", values, registry, sequenceIds, controls } };
}

/** 首次受支持的重排才调用物化；返回自有数据，拒绝不能等价保存的旧输入。 */
export function materializeNumberingSequences(
  input: NumberingSequenceInput,
): NumberingSequenceResult<MaterializedNumberingSequences> {
  const resolved = resolveNumberingSequences(input);
  if (!resolved.ok) return resolved;
  if (resolved.value.kind === "v1") return { ok: true, value: resolved.value };
  const layout = itemLayout(input.items);
  if (
    !input.items.length ||
    !layout ||
    (input.start != null && validOrderedListStart(input.start) === null) ||
    (input.levelStarts != null && !normalizeOrderedListLevelStarts(input.levelStarts)) ||
    input.items.some((item) => item.restart != null && typeof item.restart !== "boolean")
  )
    return { ok: false, reason: "unsupported-legacy" };
  const registry: NumberingSequenceRegistry = { version: 1, sequences: [] };
  const active = new Map<number, string>();
  const sequenceIds: string[] = [];
  for (const [index, item] of input.items.entries()) {
    const level = layout.levels[index];
    let id = active.get(level);
    if (id === undefined || item.restart === true) {
      if (registry.sequences.length >= maxSequences) return { ok: false, reason: "capacity-exceeded" };
      id = `s${registry.sequences.length}`;
      registry.sequences.push({
        id,
        start: resolved.value.values[index],
        origin: item.restart === true ? "restart" : "initial",
      });
      active.set(level, id);
    }
    // 较浅项会结束旧格式的子级计数；再次进入该层时创建新的局部编号序列。
    for (const deeper of active.keys()) if (deeper > level) active.delete(deeper);
    sequenceIds.push(id);
  }
  const verified = resolveNumberingSequences({
    ...input,
    registry,
    items: input.items.map((item, index) => ({ ...item, sequenceId: sequenceIds[index] })),
  });
  if (!verified.ok) return verified;
  if (
    verified.value.kind !== "v1" ||
    verified.value.values.some((value, index) => value !== resolved.value.values[index])
  )
    return { ok: false, reason: "unsupported-legacy" };
  return { ok: true, value: verified.value };
}

/** 在同一物理列表中调整层级，同时将移动项接入目标层级的编号序列。 */
export function indentNumberingSequenceItems(
  input: NumberingSequenceInput,
  selected: readonly number[],
  direction: -1 | 1,
  reservedIds: ReadonlySet<string> = new Set(),
): NumberingSequenceResult<IndentedNumberingSequences> {
  const resolved = resolveNumberingSequences(input);
  const before = itemLayout(input.items);
  const indices = new Set(selected);
  if (
    !resolved.ok ||
    resolved.value.kind !== "v1" ||
    !before ||
    !indices.size ||
    indices.size !== selected.length ||
    (direction !== -1 && direction !== 1) ||
    [...indices].some((index) => !Number.isInteger(index) || !input.items[index]?.leaf)
  )
    return { ok: false, reason: "unsupported-change" };

  const levels = before.levels.map((level, index) =>
    indices.has(index) ? Math.max(0, Math.min(MAX_INDENT, level + direction)) : level,
  );
  if (levels.every((level, index) => level === before.levels[index])) return { ok: false, reason: "no-change" };
  const after = itemLayout(input.items.map((item, index) => ({ ...item, level: levels[index] })));
  if (!after) return { ok: false, reason: "unsupported-change" };
  // 没有选择的项目不能因为前面的项目缩进而悄悄变更父项。
  if (after.parents.some((parent, index) => !indices.has(index) && parent !== before.parents[index]))
    return { ok: false, reason: "unsupported-change" };

  // 拆分交错序列或单独移走重启首项会丢失其原归属，不能猜测移回后的序列。
  const changing = new Set(
    [...indices].filter(
      (index) => levels[index] !== before.levels[index] || after.parents[index] !== before.parents[index],
    ),
  );
  const scopes = new Map<string, number>();
  const memberships = new Map<string, { indices: number[]; first: number; last: number }>();
  resolved.value.sequenceIds.forEach((id, index) => {
    const key = `${before.parents[index]}:${before.levels[index]}`;
    const ordinal = (scopes.get(key) ?? 0) + 1;
    scopes.set(key, ordinal);
    const group = memberships.get(id);
    if (group) {
      group.indices.push(index);
      group.last = ordinal;
    } else memberships.set(id, { indices: [index], first: ordinal, last: ordinal });
  });
  for (const sequence of resolved.value.registry.sequences) {
    const group = memberships.get(sequence.id);
    if (!group) continue;
    const moved = group.indices.filter((index) => changing.has(index));
    if (!moved.length || moved.length === group.indices.length) continue;
    if (
      (sequence.origin === "restart" && changing.has(group.indices[0])) ||
      group.last - group.first + 1 !== group.indices.length
    )
      return { ok: false, reason: "unsupported-change" };
  }

  const registry: NumberingSequenceRegistry = {
    version: 1,
    sequences: resolved.value.registry.sequences.map((sequence) => ({ ...sequence })),
  };
  const sourceDefinitions = new Map(resolved.value.registry.sequences.map((sequence) => [sequence.id, sequence]));
  const definitions = new Map(registry.sequences.map((sequence) => [sequence.id, sequence]));
  const firstMembers = new Map<string, number>();
  resolved.value.sequenceIds.forEach((id, index) => {
    if (!firstMembers.has(id)) firstMembers.set(id, index);
  });
  const ids: Array<string | null> = resolved.value.sequenceIds.map((id, index) =>
    levels[index] !== before.levels[index] || after.parents[index] !== before.parents[index] ? null : id,
  );
  const used = new Set([...ids.filter((id): id is string => id !== null), ...reservedIds]);
  const groups = new Map<string, string>();
  const scope = (index: number) => `${after.parents[index]}:${levels[index]}`;
  const followingInitial: Array<string | undefined> = Array(ids.length);
  const nextAtScope = new Map<string, string>();
  for (let index = ids.length - 1; index >= 0; index--) {
    const key = scope(index);
    followingInitial[index] = nextAtScope.get(key);
    const id = ids[index];
    if (id && definitions.get(id)?.origin === "initial") nextAtScope.set(key, id);
  }
  const previousAtScope = new Map<string, string>();
  let suffix = 1;
  const allocate = (oldId: string, index: number, restart: boolean): string | null => {
    const original = sourceDefinitions.get(oldId)!;
    let id = oldId;
    if (used.has(id)) {
      if (registry.sequences.length >= maxSequences) return null;
      while (definitions.has(`indent-${suffix}`) || reservedIds.has(`indent-${suffix}`)) suffix++;
      id = `indent-${suffix++}`;
      const entry = { ...original, id };
      registry.sequences.push(entry);
      definitions.set(id, entry);
    }
    const entry = definitions.get(id)!;
    entry.origin = restart ? "restart" : "initial";
    if (!restart && index !== 0) entry.start = 1;
    used.add(id);
    return id;
  };

  for (let index = 0; index < ids.length; index++) {
    const currentScope = scope(index);
    if (ids[index] !== null) {
      previousAtScope.set(currentScope, ids[index]!);
      continue;
    }
    const oldId = resolved.value.sequenceIds[index];
    const definition = sourceDefinitions.get(oldId)!;
    const restart = definition.origin === "restart" && firstMembers.get(oldId) === index;
    const key = JSON.stringify([oldId, after.parents[index], levels[index]]);
    let next = groups.get(key);
    if (!next && !restart) next = previousAtScope.get(currentScope) ?? followingInitial[index];
    if (!next) next = allocate(oldId, index, restart) ?? undefined;
    if (!next) return { ok: false, reason: "capacity-exceeded" };
    groups.set(key, next);
    ids[index] = next;
    previousAtScope.set(currentScope, next);
    used.add(next);
  }
  const sequenceIds = ids as string[];
  const checked = resolveNumberingSequences({
    ...input,
    registry,
    items: input.items.map((item, index) => ({ ...item, level: levels[index], sequenceId: sequenceIds[index] })),
  });
  if (!checked.ok || checked.value.kind !== "v1") return { ok: false, reason: "unsupported-change" };
  return { ok: true, value: { ...checked.value, levels } };
}

/** to 是移动后的最终索引；只允许同逻辑父项、同层的两个叶项之间重排。 */
export function reorderNumberingSequenceItems(
  input: NumberingSequenceInput,
  from: number,
  to: number,
): NumberingSequenceResult<MaterializedNumberingSequences & { order: number[] }> {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= input.items.length ||
    to >= input.items.length
  )
    return { ok: false, reason: "unsupported-move" };
  if (from === to) return { ok: false, reason: "no-change" };
  const layout = itemLayout(input.items);
  if (
    !layout ||
    input.items[from].leaf !== true ||
    input.items[to].leaf !== true ||
    layout.levels[from] !== layout.levels[to] ||
    layout.parents[from] !== layout.parents[to] ||
    layout.levels[from + 1] > layout.levels[from] ||
    layout.levels[to + 1] > layout.levels[to]
  )
    return { ok: false, reason: "unsupported-move" };
  const materialized = materializeNumberingSequences(input);
  if (!materialized.ok) return materialized;
  const order = input.items.map((_, index) => index);
  const [source] = order.splice(from, 1);
  order.splice(to, 0, source);
  const moved = resolveNumberingSequences({
    ...input,
    registry: materialized.value.registry,
    items: order.map((index) => ({ ...input.items[index], sequenceId: materialized.value.sequenceIds[index] })),
  });
  if (!moved.ok) return moved;
  if (moved.value.kind !== "v1") return { ok: false, reason: "unsupported-move" };
  return { ok: true, value: { ...moved.value, order } };
}

/** 显式操作服从来源与当前首成员的资格，不依赖旧项布尔标记或定义数组顺序。 */
export function changeNumberingSequence(
  input: NumberingSequenceInput,
  change: { kind: "restart" | "continue"; index: number },
): NumberingSequenceResult<MaterializedNumberingSequences> {
  const resolved = resolveNumberingSequences(input);
  if (!resolved.ok) return resolved;
  if (resolved.value.kind !== "v1") return { ok: false, reason: "unsupported-legacy" };
  const { index, kind } = change;
  if (
    (kind !== "restart" && kind !== "continue") ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= input.items.length
  )
    return { ok: false, reason: "unsupported-change" };
  if (!resolved.value.controls[index][kind]) return { ok: false, reason: "unsupported-change" };
  const layout = itemLayout(input.items);
  if (!layout) return { ok: false, reason: "invalid-member" };
  if (!leafAt(input, layout, index)) return { ok: false, reason: "unsupported-change" };
  const sequenceIds = [...resolved.value.sequenceIds];
  const sourceId = sequenceIds[index];
  const affected = sequenceIds.flatMap((id, position) => (position >= index && id === sourceId ? [position] : []));
  if (affected.some((position) => !leafAt(input, layout, position))) return { ok: false, reason: "unsupported-change" };
  const sequences = [...resolved.value.registry.sequences];
  let nextId: string;
  if (kind === "restart") {
    const ids = new Set(sequences.map((sequence) => sequence.id));
    let ordinal = 0;
    while (ids.has(`s${ordinal}`)) ordinal++;
    nextId = `s${ordinal}`;
    sequences.push({ id: nextId, start: 1, origin: "restart" });
  } else {
    let previous = index - 1;
    while (
      previous >= 0 &&
      (layout.parents[previous] !== layout.parents[index] || layout.levels[previous] !== layout.levels[index])
    )
      previous--;
    if (previous < 0) {
      const initialIds = new Set(
        sequences.filter((sequence) => sequence.origin === "initial").map((sequence) => sequence.id),
      );
      // 校验保证同作用范围至多一个活跃初始序列，定义数组的排列不参与选择。
      const initial = sequenceIds.findIndex(
        (id, position) =>
          initialIds.has(id) &&
          layout.parents[position] === layout.parents[index] &&
          layout.levels[position] === layout.levels[index],
      );
      if (initial >= 0) nextId = sequenceIds[initial];
      else {
        nextId = sourceId;
        const definition = sequences.findIndex((sequence) => sequence.id === sourceId);
        if (definition < 0) return { ok: false, reason: "missing-sequence" };
        sequences[definition] = { ...sequences[definition], origin: "initial" };
      }
    } else {
      if (!leafAt(input, layout, previous)) return { ok: false, reason: "unsupported-change" };
      nextId = sequenceIds[previous];
      if (nextId === sourceId) return { ok: false, reason: "no-change" };
    }
  }
  for (const position of affected) sequenceIds[position] = nextId;
  // 只有显式编号操作清理空定义；读取和普通编辑仍完整保留合法 registry。
  const used = new Set(sequenceIds);
  const registry: NumberingSequenceRegistry = {
    version: 1,
    sequences: sequences.filter((sequence) => used.has(sequence.id)),
  };
  const edited = resolveNumberingSequences({
    ...input,
    registry,
    items: input.items.map((item, position) => ({ ...item, sequenceId: sequenceIds[position] })),
  });
  if (!edited.ok) return edited;
  if (edited.value.kind !== "v1") return { ok: false, reason: "unsupported-change" };
  return { ok: true, value: edited.value };
}
