import { expect, test } from "@rstest/core";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { createDatabaseViewState } from "../../../packages/core/src/features/database/view-state";

test("数据表视图状态随文档切换重置，且实例互不共享", () => {
  const data = createDatabaseData();
  const first = createDatabaseViewState();
  const second = createDatabaseViewState();
  const viewId = data.views[0].id;
  const fieldId = data.fields[0].id;
  expect(first.resetForDatabase(data.id)).toBe(true);
  first.calendarMonths.set(viewId, { year: 2026, month: 11 });
  first.collapsedGroupsByView.set(viewId, new Map([[fieldId, new Set(["分组"])]]));
  expect(first.resetForDatabase(data.id)).toBe(false);
  expect(first.calendarMonths.has(viewId)).toBe(true);
  expect(second.calendarMonths.size).toBe(0);
  expect(second.collapsedGroupsByView.size).toBe(0);
  expect(first.resetForDatabase(`${data.id}-next`)).toBe(true);
  expect(first.calendarMonths.size).toBe(0);
  expect(first.collapsedGroupsByView.size).toBe(0);
});

test("移除视图和字段后只清理失效的视图状态", () => {
  const data = createDatabaseData();
  const state = createDatabaseViewState();
  const viewId = data.views[0].id;
  const fieldId = data.fields[0].id;
  state.resetForDatabase(data.id);
  state.calendarMonths.set(viewId, { year: 2026, month: 11 });
  state.calendarMonths.set("removed-view", { year: 2026, month: 10 });
  state.collapsedGroupsByView.set(
    viewId,
    new Map([
      [fieldId, new Set(["保留"])],
      ["removed-field", new Set(["删除"])],
    ]),
  );
  state.collapsedGroupsByView.set("removed-view", new Map());
  state.prune(data);
  expect([...state.calendarMonths.keys()]).toEqual([viewId]);
  expect([...state.collapsedGroupsByView.keys()]).toEqual([viewId]);
  expect([...state.collapsedGroupsByView.get(viewId)!.keys()]).toEqual([fieldId]);
});
