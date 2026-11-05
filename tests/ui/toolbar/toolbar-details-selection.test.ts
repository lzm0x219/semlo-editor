import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

import { detailsToolbarSelection } from "../../../packages/core/src/features/blocks/details-selection";

test("classifies a details title, same-card cross selection, and unrelated selections", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      details: { group: "block", content: "detailsSummary detailsContent" },
      detailsSummary: { content: "text*" },
      detailsContent: { content: "block+" },
      text: { group: "inline" },
    },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, schema.text("外")),
    schema.node("details", null, [
      schema.node("detailsSummary", null, schema.text("标题")),
      schema.node("detailsContent", null, schema.node("paragraph", null, schema.text("正文"))),
    ]),
  ]);
  const positions: Record<string, number> = {};
  doc.descendants((node, pos) => {
    if (node.isText) positions[node.text!] = pos;
  });
  const [title, body, outside] = [positions["标题"], positions["正文"], positions["外"]];
  expect(detailsToolbarSelection(TextSelection.create(doc, title))).toBe("summary");
  expect(detailsToolbarSelection(TextSelection.create(doc, title, title + 2))).toBe("summary");
  expect(detailsToolbarSelection(TextSelection.create(doc, title, body + 2))).toBe("summary-and-body");
  expect(detailsToolbarSelection(TextSelection.create(doc, body + 2, title))).toBe("summary-and-body");
  expect(detailsToolbarSelection(TextSelection.create(doc, body))).toBe("other");
  expect(detailsToolbarSelection(TextSelection.create(doc, outside, title + 1))).toBe("other");
});
