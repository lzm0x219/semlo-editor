import type { JSONContent } from "@tiptap/core";

import { createEditor } from "../../../packages/core/src/editor/create-editor";

for (const kind of ["callout", "details", "foldCallout"] as const) {
  const host = document.createElement("div");
  host.id = `paragraph-slash-${kind}`;
  document.body.append(host);
  const content: JSONContent =
    kind === "callout"
      ? { type: "callout", content: [{ type: "paragraph" }] }
      : {
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary" },
            {
              type: "detailsContent",
              content: [
                kind === "foldCallout" ? { type: "callout", content: [{ type: "paragraph" }] } : { type: "paragraph" },
              ],
            },
          ],
        };
  createEditor({ element: host, outline: false, content: { type: "doc", content: [content] } });
}
