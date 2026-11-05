import type { JSONContent } from "@tiptap/core";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { isHeadingSlashSuppressed } from "../../../packages/core/src/features/insertion/toolbar-slash-heading-context";
import { isListSlashSuppressed } from "../../../packages/core/src/features/insertion/toolbar-slash-list-context";

const paragraph = (text = "") => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
let mounted: ReturnType<typeof createEditor> | undefined;
Object.assign(window, {
  listSlashFixture: {
    mountHeading(level: number, text = "") {
      mounted?.destroy();
      document.querySelector("#slash-list-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "slash-list-fixture";
      document.body.append(host);
      mounted = createEditor({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [{ type: "heading", attrs: { level }, content: text ? [{ type: "text", text }] : [] }],
        },
      });
    },
    mountNestedHeading(container: "blockquote" | "details" | "callout" | "foldCallout", level = 2, text = "/原文") {
      mounted?.destroy();
      document.querySelector("#slash-list-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "slash-list-fixture";
      document.body.append(host);
      const heading = { type: "heading", attrs: { level }, content: text ? [{ type: "text", text }] : [] };
      const content =
        container !== "details" && container !== "foldCallout"
          ? [{ type: container, content: [heading] }]
          : [
              {
                type: "details",
                attrs: { open: true },
                content: [
                  { type: "detailsSummary" },
                  {
                    type: "detailsContent",
                    content: [container === "foldCallout" ? { type: "callout", content: [heading] } : heading],
                  },
                ],
              },
            ];
      mounted = createEditor({ element: host, outline: false, content: { type: "doc", content } });
    },
    mountDetailsParagraph(text: string) {
      mounted?.destroy();
      document.querySelector("#slash-list-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "slash-list-fixture";
      document.body.append(host);
      mounted = createEditor({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "details",
              attrs: { open: true },
              content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [paragraph(text)] }],
            },
          ],
        },
      });
    },
    mount(kind: "bullet" | "ordered" | "task" | "paragraph", suffix = "", depth = 0, child = false, multi = false) {
      mounted?.destroy();
      document.querySelector("#slash-list-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "slash-list-fixture";
      document.body.append(host);
      const item = kind === "task" ? "taskItem" : "listItem";
      const list = kind === "bullet" ? "bulletList" : kind === "ordered" ? "orderedList" : "taskList";
      let node: JSONContent =
        kind === "paragraph"
          ? paragraph(suffix)
          : {
              type: list,
              content: [
                {
                  type: item,
                  content: [
                    paragraph(suffix),
                    ...(multi ? [paragraph("另一正文段")] : []),
                    ...(child
                      ? [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("子项")] }] }]
                      : []),
                  ],
                },
              ],
            };
      for (let i = 0; i < depth; i++)
        node = { type: "bulletList", content: [{ type: "listItem", content: [paragraph("父项"), node] }] };
      mounted = createEditor({ element: host, outline: false, content: { type: "doc", content: [node] } });
    },
    snapshot() {
      return mounted?.editor.getJSON();
    },
    checkHeading(from: number, to: number) {
      if (!mounted) return false;
      return isHeadingSlashSuppressed(mounted.editor.state, { from, to });
    },
    checkNestedHeading() {
      if (!mounted) return false;
      let start = -1;
      mounted.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") start = pos + 1;
      });
      return isHeadingSlashSuppressed(mounted.editor.state, { from: start, to: start + 1 });
    },
    check(text: string, fromOffset: number, toOffset: number) {
      if (!mounted) return false;
      let start = -1;
      mounted.editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === text) start = pos + 1;
      });
      return isListSlashSuppressed(mounted.editor.state, { from: start + fromOffset, to: start + toOffset });
    },
  },
});
