import {
  DatabaseContentError,
  orderedDatabaseFields,
  visibleDatabaseRecords,
  databaseValueText,
  type DatabaseData,
} from "./model";
import { validateDatabaseData } from "./validation";

export function parseData(value: string | null): DatabaseData {
  if (!value) throw new DatabaseContentError("缺少数据载荷");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new DatabaseContentError("数据载荷不是有效 JSON");
  }
  return validateDatabaseData(parsed);
}

export function exportTable(data: DatabaseData) {
  const active = data.views.find((view) => view.id === data.activeViewId);
  if (!active) return { fields: data.fields, records: data.records };
  return {
    fields: orderedDatabaseFields(data, active),
    records: visibleDatabaseRecords(data, { ...active, filters: [] }),
  };
}

export function toText(data: DatabaseData): string {
  const { fields, records } = exportTable(data);
  return [
    fields.map((field) => field.name).join("\t"),
    ...records.map((record) => fields.map((field) => databaseValueText(field, record.values[field.id])).join("\t")),
  ].join("\n");
}
