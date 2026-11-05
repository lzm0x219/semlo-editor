import { normalizeDatabaseData, type DatabaseActor, type DatabaseData, type DatabaseValue } from "./model";

export interface DatabaseChangeBaseline {
  serialized: string;
  records: Map<string, Record<string, DatabaseValue>>;
  fieldIds: Set<string>;
  fieldTypes: string;
}

/** 捕获变更前的记录值，供元数据和视图引用更新使用。 */
export function captureDatabaseChange(data: DatabaseData): DatabaseChangeBaseline {
  return {
    serialized: JSON.stringify(data),
    records: new Map(data.records.map((record) => [record.id, { ...record.values }])),
    fieldIds: new Set(data.fields.map((field) => field.id)),
    fieldTypes: JSON.stringify(data.fields.map(({ id, type }) => [id, type])),
  };
}

/** 对工作副本更新受影响记录及引用；调用者负责检查异步和重入后的文档归属。 */
export function finalizeDatabaseChange(
  data: DatabaseData,
  baseline: DatabaseChangeBaseline,
  getActor: () => DatabaseActor | null,
): DatabaseData {
  if (data.records.length < baseline.records.size) {
    const surviving = new Set(data.records.map((record) => record.id));
    for (const view of data.views) {
      view.recordOrder = view.recordOrder.filter((id) => surviving.has(id));
      view.boardOrder = view.boardOrder.filter((id) => surviving.has(id));
    }
  }
  const fields = data.fields.filter(
    (field) =>
      baseline.fieldIds.has(field.id) &&
      !["createdTime", "modifiedTime", "createdBy", "modifiedBy"].includes(field.type),
  );
  let editActor: DatabaseActor | null | undefined;
  for (const record of data.records) {
    const previous = baseline.records.get(record.id);
    if (
      !previous ||
      !fields.some((field) => {
        const before = previous[field.id];
        const after = record.values[field.id];
        return before !== after && JSON.stringify(before) !== JSON.stringify(after);
      })
    )
      continue;
    record.modifiedAt = new Date().toISOString();
    const actor = editActor === undefined ? (editActor = getActor()) : editActor;
    if (actor) record.modifiedBy = actor;
    else delete record.modifiedBy;
    for (const field of data.fields) {
      if (field.type === "modifiedTime") record.values[field.id] = record.modifiedAt;
      if (field.type === "modifiedBy") record.values[field.id] = actor ?? "";
    }
  }
  // 字段类型变化时，同步修复视图引用；图表始终使用归一化后的配置。
  const fieldsChanged = baseline.fieldTypes !== JSON.stringify(data.fields.map(({ id, type }) => [id, type]));
  const normalized = normalizeDatabaseData(data);
  return fieldsChanged || data.views.some((view) => view.kind === "chart") ? normalized : data;
}
