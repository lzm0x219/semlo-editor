import type { JSONContent } from "@tiptap/core";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
  createDatabaseId,
  createDatabaseView,
  type DatabaseView,
} from "../packages/core/src/features/database/model";

/** A single set of records shared by the database views. */
export function createDemoDatabase(now = new Date(), initialView: DatabaseView["kind"] = "table"): JSONContent {
  const data = createDatabaseData();
  const [name, status, date] = data.fields;
  name.name = "事项";
  status.name = "状态";

  const tags = createDatabaseField("标签", "multiSelect");
  tags.options = ["灵感", "写作", "回顾"].map((label, color) => ({ id: createDatabaseId("option"), label, color }));
  const effort = createDatabaseField("工作量（小时）", "number");
  const done = createDatabaseField("已归档", "checkbox");
  const link = createDatabaseField("参考链接", "link");
  const email = createDatabaseField("联系邮箱", "email");
  const phone = createDatabaseField("联系电话", "phone");
  const rating = createDatabaseField("评分", "rating");
  const progress = createDatabaseField("进度", "progress");
  const endDate = createDatabaseField("结束日期", "date");
  data.fields.push(tags, effort, done, link, email, phone, rating, progress, endDate);

  const entries = [
    { title: "收集灵感", tagIds: [tags.options[0].id], hours: "3", done: false, rating: "4", progress: "15" },
    {
      title: "整理内容",
      tagIds: [tags.options[0].id, tags.options[1].id],
      hours: "5",
      done: false,
      rating: "5",
      progress: "60",
    },
    { title: "回顾与分享", tagIds: [tags.options[2].id], hours: "2", done: true, rating: "5", progress: "100" },
  ];
  // Keep a cross-week example in the current month regardless of today's date.
  const crossWeekStart = new Date(now.getFullYear(), now.getMonth(), 15);
  crossWeekStart.setDate(crossWeekStart.getDate() + ((7 - crossWeekStart.getDay()) % 7));

  data.records.forEach((record, index) => {
    const entry = entries[index];
    // The chart-specific example includes recent dates so the heatmap shows
    // multiple populated weeks; other examples keep the cross-week event.
    const due =
      initialView === "chart"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - index * 7)
        : index === 1
          ? crossWeekStart
          : new Date(now.getFullYear(), now.getMonth(), now.getDate() + index * 3);
    const year = due.getFullYear();
    const month = String(due.getMonth() + 1).padStart(2, "0");
    const day = String(due.getDate()).padStart(2, "0");
    record.values[name.id] = entry.title;
    record.values[status.id] = status.options[index].id;
    record.values[date.id] = `${year}-${month}-${day}`;
    const end = new Date(due.getFullYear(), due.getMonth(), due.getDate() + (index < 2 ? 2 : 0));
    record.values[endDate.id] =
      `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    record.values[tags.id] = entry.tagIds;
    record.values[effort.id] = entry.hours;
    record.values[done.id] = entry.done;
    record.values[link.id] = `https://example.com/notes/${index + 1}`;
    record.values[email.id] = "hello@example.com";
    record.values[phone.id] = "13800000000";
    record.values[rating.id] = entry.rating;
    record.values[progress.id] = entry.progress;
  });

  const gallery = createDatabaseView("画册视图", "gallery");
  const board = createDatabaseView("看板视图", "kanban");
  const hiddenCardFields = data.fields
    .slice(3)
    .filter((field) => field.id !== tags.id)
    .map((field) => field.id);
  gallery.hiddenFields = [...hiddenCardFields];
  board.hiddenFields = [...hiddenCardFields];
  board.groupFieldId = status.id;
  const calendar = createDatabaseView("日历视图", "calendar");
  calendar.calendar.titleFieldId = name.id;
  calendar.calendar.startFieldId = date.id;
  calendar.calendar.endFieldId = endDate.id;
  calendar.calendar.colorFieldId = status.id;
  calendar.calendar.showLunar = true;
  const chart = createDatabaseView("图表视图", "chart");
  const column = createDatabaseChart("column", data.fields);
  column.title = "状态分布";
  const bar = createDatabaseChart("bar", data.fields);
  bar.title = "各事项工作量（小时）";
  bar.fieldId = name.id;
  bar.metricFieldId = effort.id;
  bar.statistic = "sum";
  const pie = createDatabaseChart("pie", data.fields);
  pie.title = "状态占比";
  const number = createDatabaseChart("number", data.fields);
  number.title = "事项总数";
  number.description = "条记录";
  const area = createDatabaseChart("area", data.fields);
  area.title = "每日工作量面积图（小时）";
  area.fieldId = date.id;
  area.metricFieldId = effort.id;
  area.statistic = "sum";
  area.groupFieldId = "";
  area.sort = "text-asc";
  const line = createDatabaseChart("line", data.fields);
  line.title = "每日工作量趋势（小时）";
  line.fieldId = date.id;
  line.metricFieldId = effort.id;
  line.statistic = "sum";
  line.groupFieldId = "";
  line.sort = "text-asc";
  const scatter = createDatabaseChart("scatter", data.fields);
  scatter.title = "各状态工作量散点（小时）";
  scatter.fieldId = status.id;
  scatter.metricFieldId = effort.id;
  scatter.statistic = "sum";
  const heatmap = createDatabaseChart("heatmap", data.fields);
  heatmap.title = "每日工作量热力图（小时）";
  heatmap.fieldId = date.id;
  heatmap.metricFieldId = effort.id;
  heatmap.statistic = "sum";
  heatmap.heatmapWeeks = 8;
  heatmap.heatmapMax = 6;
  const funnel = createDatabaseChart("funnel", data.fields);
  funnel.title = "事项进度漏斗";
  funnel.fieldId = status.id;
  const wordcloud = createDatabaseChart("wordcloud", data.fields);
  wordcloud.title = "标签词云";
  wordcloud.fieldId = tags.id;
  chart.charts.push(column, bar, pie, number, area, line, scatter, heatmap, funnel, wordcloud);
  data.views.push(gallery, board, calendar, chart);
  data.activeViewId = data.views.find((view) => view.kind === initialView)?.id ?? data.activeViewId;

  return { type: "semloEditorDatabase", attrs: { data } };
}
