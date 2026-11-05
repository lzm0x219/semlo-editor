import { expect, test } from "@rstest/core";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import {
  captureDatabaseChange,
  finalizeDatabaseChange,
} from "../../../packages/core/src/features/database/record-change";

test("record changes update metadata once and prune removed record references", () => {
  const data = createDatabaseData({ id: "previous", label: "之前" });
  const time = createDatabaseField("修改时间", "modifiedTime");
  const by = createDatabaseField("修改人", "modifiedBy");
  data.fields.push(time, by);
  const ids = data.records.map((record) => record.id);
  data.views[0].recordOrder = [...ids];
  data.views[0].boardOrder = [...ids];
  const baseline = captureDatabaseChange(data);
  data.records[0].values[data.fields[0].id] = "第一条";
  data.records[1].values[data.fields[0].id] = "第二条";
  data.records.pop();
  let calls = 0;
  const actor = { id: "editor", label: "编辑人" };
  const result = finalizeDatabaseChange(data, baseline, () => {
    calls++;
    return actor;
  });
  expect(calls).toBe(1);
  expect(result.views[0].recordOrder).toEqual(ids.slice(0, 2));
  expect(result.views[0].boardOrder).toEqual(ids.slice(0, 2));
  for (const record of result.records) {
    expect(record.modifiedBy).toEqual(actor);
    expect(record.values[by.id]).toEqual(actor);
    expect(record.values[time.id]).toBe(record.modifiedAt);
  }
});

test("unchanged records do not request a current user or rewrite metadata", () => {
  const data = createDatabaseData({ id: "previous", label: "之前" });
  const baseline = captureDatabaseChange(data);
  const result = finalizeDatabaseChange(data, baseline, () => {
    throw new Error("未变更的记录不应读取修改人");
  });
  expect(JSON.stringify(result)).toBe(baseline.serialized);
});
