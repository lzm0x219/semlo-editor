import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import { findDatabaseMatches } from "../../../packages/core/src/features/database/find-database-matches";
import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
    text: { group: "inline" },
  },
});

test("search respects ordered multi-select combinations in both group directions", () => {
  const data = createDatabaseData();
  const group = createDatabaseField("分组", "multiSelect");
  group.options = [
    { id: "b", label: "乙", color: 0 },
    { id: "a", label: "甲", color: 1 },
  ];
  const text = createDatabaseField("内容");
  data.fields.push(group, text);
  const [ab, ba, empty] = data.records;
  ab.values[group.id] = ["a", "b"];
  ba.values[group.id] = ["b", "a"];
  empty.values[group.id] = [];
  for (const record of data.records) record.values[text.id] = "共同命中";
  const view = data.views[0];
  view.groupFieldId = group.id;
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  view.groupDirection = "asc";
  expect(findDatabaseMatches(doc(), "共同命中").map((match) => match.recordId)).toEqual([ba.id, ab.id, empty.id]);
  view.groupDirection = "desc";
  expect(findDatabaseMatches(doc(), "共同命中").map((match) => match.recordId)).toEqual([ab.id, ba.id, empty.id]);
});
