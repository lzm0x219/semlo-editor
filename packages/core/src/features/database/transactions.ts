import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { Step, StepMap, StepResult, type Mappable } from "@tiptap/pm/transform";

import { databaseLimits, normalizeDatabaseActor, type DatabaseActor } from "./model";
import { validateDatabaseData } from "./validation";

/** Records a single cell change while keeping all document positions stable. */
export class DatabaseCellStep extends Step {
  constructor(
    readonly position: number,
    readonly databaseId: string,
    readonly recordId: string,
    readonly fieldId: string,
    readonly before: string,
    readonly after: string,
    readonly beforeTime?: string | null,
    readonly afterTime?: string | null,
    readonly beforeActor?: DatabaseActor | null,
    readonly afterActor?: DatabaseActor | null,
  ) {
    super();
  }
  apply(doc: ProseMirrorNode): StepResult {
    const node = doc.nodeAt(this.position);
    if (!node || node.type.name !== "semloEditorDatabase") return StepResult.fail("数据表不存在");
    if (this.after.length > databaseLimits.text)
      return StepResult.fail(`数据表文本长度不能超过 ${databaseLimits.text} 个字符`);
    const data = validateDatabaseData(node.attrs.data);
    if (data.id !== this.databaseId) return StepResult.fail("数据表已替换");
    const record = data.records.find((item) => item.id === this.recordId);
    if (!record || !data.fields.some((item) => item.id === this.fieldId)) return StepResult.fail("数据表记录不存在");
    record.values[this.fieldId] = this.after;
    if (this.afterTime !== undefined) {
      if (this.afterTime === null) delete record.modifiedAt;
      else record.modifiedAt = this.afterTime;
      for (const field of data.fields)
        if (field.type === "modifiedTime") record.values[field.id] = this.afterTime ?? "";
    }
    if (this.afterActor !== undefined) {
      if (this.afterActor === null) delete record.modifiedBy;
      else record.modifiedBy = this.afterActor;
      for (const field of data.fields) if (field.type === "modifiedBy") record.values[field.id] = this.afterActor ?? "";
    }
    const replacement = node.type.create({ ...node.attrs, data }, node.content, node.marks);
    return StepResult.fromReplace(
      doc,
      this.position,
      this.position + node.nodeSize,
      new Slice(Fragment.from(replacement), 0, 0),
    );
  }
  getMap(): StepMap {
    return StepMap.empty;
  }
  invert(): Step {
    return new DatabaseCellStep(
      this.position,
      this.databaseId,
      this.recordId,
      this.fieldId,
      this.after,
      this.before,
      this.afterTime,
      this.beforeTime,
      this.afterActor,
      this.beforeActor,
    );
  }
  map(mapping: Mappable): Step | null {
    const mapped = mapping.mapResult(this.position, 1);
    return mapped.deleted
      ? null
      : new DatabaseCellStep(
          mapped.pos,
          this.databaseId,
          this.recordId,
          this.fieldId,
          this.before,
          this.after,
          this.beforeTime,
          this.afterTime,
          this.beforeActor,
          this.afterActor,
        );
  }
  toJSON() {
    return {
      stepType: "semloEditorDatabaseCell",
      position: this.position,
      databaseId: this.databaseId,
      recordId: this.recordId,
      fieldId: this.fieldId,
      before: this.before,
      after: this.after,
      beforeTime: this.beforeTime,
      afterTime: this.afterTime,
      beforeActor: this.beforeActor,
      afterActor: this.afterActor,
    };
  }
  static fromJSON(_schema: Schema, json: Record<string, unknown>): DatabaseCellStep {
    if (
      !Number.isInteger(json.position) ||
      typeof json.databaseId !== "string" ||
      typeof json.recordId !== "string" ||
      typeof json.fieldId !== "string" ||
      typeof json.before !== "string" ||
      typeof json.after !== "string"
    )
      throw new RangeError("Invalid database cell step");
    return new DatabaseCellStep(
      json.position as number,
      json.databaseId,
      json.recordId,
      json.fieldId,
      json.before,
      json.after,
      typeof json.beforeTime === "string" || json.beforeTime === null ? json.beforeTime : undefined,
      typeof json.afterTime === "string" || json.afterTime === null ? json.afterTime : undefined,
      json.beforeActor === null ? null : (normalizeDatabaseActor(json.beforeActor) ?? undefined),
      json.afterActor === null ? null : (normalizeDatabaseActor(json.afterActor) ?? undefined),
    );
  }
}

// A module can be re-evaluated during development hot reload.
try {
  Step.jsonID("semloEditorDatabaseCell", DatabaseCellStep);
} catch {
  /* A compatible registration already exists. */
}
