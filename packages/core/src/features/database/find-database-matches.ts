import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { getCardVisibleFields } from "./card-fields";
import {
  databaseValueText,
  databaseGroupKey,
  normalizeDatabaseData,
  orderedDatabaseFields,
  visibleDatabaseRecords,
  type DatabaseField,
  type DatabaseRecord,
  type DatabaseView,
} from "./model";

export type FindTableProjection = {
  groups: ReadonlyArray<{ key: string; recordIds: readonly string[]; collapsed: boolean }>;
};

export interface DatabaseFindMatch {
  kind: "database";
  /** The position of the atom itself, not a position inside its attributes. */
  from: number;
  to: number;
  databaseId: string;
  recordId: string;
  fieldId: string;
  start: number;
  end: number;
}

/** Follow the table's group identity and displayed order. */
export function orderedFindTableGroups(records: DatabaseRecord[], field: DatabaseField, view: DatabaseView) {
  const groups = new Map<string, { label: string; records: DatabaseRecord[] }>();
  for (const record of records) {
    const value = record.values[field.id];
    const key = databaseGroupKey(field, value);
    const text = databaseValueText(field, value);
    const label = field.type === "checkbox" ? (text ? "已勾选" : "未勾选") : text || "（空）";
    const group = groups.get(key) ?? { label, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  const ranks = new Map(field.options.map((option, index) => [option.id, index]));
  const optionOrder = (group: { records: DatabaseRecord[] }) => {
    const value = group.records[0]?.values[field.id];
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string" && value
        ? [value]
        : [];
    return ids.map((id) => ranks.get(id)).filter((rank): rank is number => rank !== undefined);
  };
  const optionBased = field.type === "singleSelect" || field.type === "multiSelect";
  return [...groups.values()].sort((a, b) => {
    let comparison = 0;
    if (optionBased) {
      const left = optionOrder(a),
        right = optionOrder(b);
      if (!left.length || !right.length) return left.length ? -1 : right.length ? 1 : 0;
      else {
        for (let index = 0; index < Math.min(left.length, right.length); index++) {
          comparison = left[index] - right[index];
          if (comparison) break;
        }
        if (!comparison) comparison = left.length - right.length;
      }
    } else comparison = a.label.localeCompare(b.label, "zh-CN");
    return view.groupDirection === "desc" ? -comparison : comparison;
  });
}

/** Case folding may expand a code point; retain offsets into the original text. */
export function foldFindText(text: string) {
  let value = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < text.length;) {
    const point = text.codePointAt(offset)!;
    const char = String.fromCodePoint(point);
    const lower = char.toLowerCase();
    value += lower;
    for (let i = 0; i < lower.length; i++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  return { value, starts, ends };
}

/** Find non-overlapping ranges within a single string in its original offsets. */
export function findStringRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const needle = foldFindText(query).value;
  if (!text || !needle) return [];
  const folded = foldFindText(text);
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset <= folded.value.length - needle.length) {
    const found = folded.value.indexOf(needle, offset);
    if (found < 0) break;
    const last = found + needle.length - 1;
    // Yuque permits a match starting inside a lowercase expansion, but not
    // ending inside one; the selected range still covers the original character.
    if (last + 1 < folded.value.length && folded.ends[last] === folded.ends[last + 1]) {
      offset = found + 1;
      continue;
    }
    const start = folded.starts[found];
    const end = folded.ends[last];
    const previous = ranges[ranges.length - 1];
    if (!previous || start >= previous.end) ranges.push({ start, end });
    offset = found + needle.length;
  }
  return ranges;
}

/** Keep table matches separate from document coordinates so they cannot be replaced as text. */
export function findDatabaseMatches(
  doc: ProseMirrorNode,
  query: string,
  viewAt?: (position: number) => string | undefined,
  projectionAt?: (position: number, node: ProseMirrorNode, view: DatabaseView) => FindTableProjection | undefined,
): DatabaseFindMatch[] {
  if (!query) return [];
  const matches: DatabaseFindMatch[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "semloEditorDatabase") return true;
    if (!node.attrs.data) return false;
    const data = normalizeDatabaseData(node.attrs.data);
    const view = data.views.find((item) => item.id === (viewAt?.(position) ?? data.activeViewId)) ?? data.views[0];
    let records = view ? visibleDatabaseRecords(data, view) : data.records;
    if (view?.kind === "kanban") {
      const field =
        data.fields.find((item) => item.id === view.groupFieldId && item.type === "singleSelect") ??
        data.fields.find((item) => item.type === "singleSelect");
      records = field
        ? ["", ...field.options.map((option) => option.id)].flatMap((id) =>
            records.filter((record) => (record.values[field.id] || "") === id),
          )
        : [];
    } else if (view?.kind === "table" && view.groupFieldId) {
      const field = data.fields.find((item) => item.id === view.groupFieldId);
      if (field) {
        const projection = projectionAt?.(position, node, view);
        if (projection) {
          // The snapshot describes rows currently painted, including delayed filter updates.
          const byId = new Map(data.records.map((record) => [record.id, record]));
          records = projection.groups.flatMap((group) =>
            group.collapsed
              ? []
              : group.recordIds.flatMap((id) => {
                  const record = byId.get(id);
                  return record ? [record] : [];
                }),
          );
        } else records = orderedFindTableGroups(records, field, view).flatMap((group) => group.records);
      }
    }
    // Cards use the first visible field as title, followed by the remaining fields.
    const isCardView = view?.kind === "gallery" || view?.kind === "kanban";
    const fields = view
      ? isCardView
        ? getCardVisibleFields(data, view)
        : orderedDatabaseFields(data, view)
      : data.fields;
    const titleField = isCardView ? fields[0] : undefined;
    for (const record of records) {
      for (const field of fields) {
        if (view?.hiddenFields.includes(field.id)) continue;
        // Checkboxes display an icon rather than the synthetic export text.
        // A checkbox used as a card's fallback title instead displays that text.
        if (field.type === "checkbox" && field !== titleField) continue;
        const value = record.values[field.id];
        // Distinct multi-select and person chips are separate visual labels, not one text run.
        const text =
          (field.type === "multiSelect" || field.type === "person") && Array.isArray(value) && field !== titleField
            ? value.map((id) => field.options.find((option) => option.id === id)?.label ?? "").join("\0")
            : databaseValueText(field, value);
        for (const range of findStringRanges(text, query)) {
          matches.push({
            kind: "database",
            from: position,
            to: position + node.nodeSize,
            databaseId: data.id,
            recordId: record.id,
            fieldId: field.id,
            ...range,
          });
        }
      }
    }
    return false;
  });
  return matches;
}
