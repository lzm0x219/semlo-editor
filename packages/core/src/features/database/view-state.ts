import type { DatabaseData } from "./model";

/** 当前节点视图的临时状态，不写入文档或跨实例共享。 */
export function createDatabaseViewState() {
  let databaseId = "";
  const calendarMonths = new Map<string, { year: number; month: number }>();
  const collapsedGroupsByView = new Map<string, Map<string, Set<string>>>();

  return {
    calendarMonths,
    collapsedGroupsByView,
    resetForDatabase(id: string) {
      if (databaseId === id) return false;
      calendarMonths.clear();
      collapsedGroupsByView.clear();
      databaseId = id;
      return true;
    },
    prune(data: DatabaseData) {
      for (const id of calendarMonths.keys())
        if (!data.views.some((entry) => entry.id === id)) calendarMonths.delete(id);
      for (const [id, groups] of collapsedGroupsByView) {
        if (!data.views.some((entry) => entry.id === id)) collapsedGroupsByView.delete(id);
        else
          for (const fieldId of groups.keys())
            if (!data.fields.some((field) => field.id === fieldId)) groups.delete(fieldId);
      }
    },
  };
}
