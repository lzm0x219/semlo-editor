import "../../../packages/core/src/styles/style.css";
import { closeHistory } from "@tiptap/pm/history";

import { createEditor } from "../../../packages/core/src/index";

const host = document.createElement("div");
host.style.width = "800px";
document.body.append(host);
Object.assign(window, {
  closeColumnsHistory: closeHistory,
  concurrentColumnsEditor: createEditor({
    element: host,
    outline: false,
    content: {
      type: "doc",
      content: [
        {
          type: "semloEditorColumns",
          content: ["甲", "乙", "丙"].map((text, index) => ({
            type: "semloEditorColumn",
            content: [
              { type: "paragraph", content: [{ type: "text", text }] },
              ...(index === 0
                ? [
                    {
                      type: "details",
                      attrs: { open: true },
                      content: [
                        { type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] },
                        {
                          type: "detailsContent",
                          content: [{ type: "paragraph", content: [{ type: "text", text: "折叠正文" }] }],
                        },
                      ],
                    },
                  ]
                : []),
            ],
          })),
        },
      ],
    },
  }),
});
