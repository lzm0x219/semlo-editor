import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import {
  filterInsertCommands,
  isDetailsBodyInsert,
  isInsertCommandAllowed,
} from "../../../packages/core/src/features/insertion/toolbar-insert-context";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    details: { group: "block", content: "detailsContent" },
    detailsContent: { content: "block+" },
    blockquote: { group: "block", content: "block+" },
    text: { group: "inline" },
  },
});

function stateIn(parent: "detailsContent" | "blockquote" | "doc") {
  const paragraph = schema.node("paragraph", null, schema.text("x"));
  const child =
    parent === "detailsContent"
      ? schema.node("details", null, schema.node("detailsContent", null, paragraph))
      : parent === "blockquote"
        ? schema.node("blockquote", null, paragraph)
        : paragraph;
  const doc = schema.node("doc", null, child);
  let position = 0;
  doc.descendants((node, pos) => {
    if (node.isText) position = pos;
  });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, position) });
}

test("only a details body filters restricted commands for every insertion surface", () => {
  const ids = ["table", "database", "album", "kanban", "details", "columns", "columns2", "columns3", "columns4"];
  const allowed = ["image", "attachment", "status", "callout", "calendar", "date", "gallery"];
  const all = [...ids, ...allowed].map((id) => ({ id }));
  const details = stateIn("detailsContent");
  expect(isDetailsBodyInsert(details)).toBe(true);
  for (const surface of ["search", "recent"]) {
    expect(
      filterInsertCommands(details, all).map((item) => item.id),
      surface,
    ).toEqual(allowed);
  }
  // The slash UI omits its entire quick-format row in this context.
  expect(isDetailsBodyInsert(details)).toBe(true);
  for (const id of ids) expect(isInsertCommandAllowed(details, id), id).toBe(false);
  for (const id of allowed) expect(isInsertCommandAllowed(details, id), id).toBe(true);
  for (const parent of ["doc", "blockquote"] as const) {
    const state = stateIn(parent);
    expect(isDetailsBodyInsert(state)).toBe(false);
    expect(filterInsertCommands(state, all)).toEqual(all);
  }
});
