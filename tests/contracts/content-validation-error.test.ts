import { expect, test } from "@rstest/core";
import { Schema } from "@tiptap/pm/model";

import { createCheckedJSONDocument } from "../../packages/core/src/editor/content/parse";
import { ContentValidationError } from "../../packages/core/src/shared/content-error";

test("feature validators retain their error without a parser dependency on that feature", () => {
  const issue = new ContentValidationError("原始载荷不受支持");
  const schema = new Schema({
    nodes: {
      doc: { content: "sample" },
      text: {},
      sample: {
        attrs: {
          data: {
            default: null,
            validate: () => {
              throw issue;
            },
          },
        },
      },
    },
  });
  try {
    createCheckedJSONDocument({ type: "doc", content: [{ type: "sample" }] }, schema);
    throw new Error("校验未执行");
  } catch (error) {
    expect(error).toBe(issue);
  }
});

test("unrelated schema errors keep Tiptap's existing wrapper", () => {
  const schema = new Schema({ nodes: { doc: { content: "text*" }, text: {} } });
  expect(() => createCheckedJSONDocument({ type: "doc", content: [{ type: "missing" }] }, schema)).toThrow(
    "[tiptap error]: Invalid JSON content",
  );
});
