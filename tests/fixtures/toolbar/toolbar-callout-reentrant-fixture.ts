import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { insertCalloutSiblingFromSlash } from "../../../packages/core/src/features/blocks/toolbar-callout-insert";
const p = (s: string) => ({ type: "paragraph", content: [{ type: "text", text: s }] });
Object.assign(window, {
  calloutReentrant: (mode: string) => {
    const el = document.createElement("div");
    document.body.append(el);
    const external = document.createElement("button");
    document.body.append(external);
    let c: ReturnType<typeof createEditor>;
    c = createEditor({
      element: el,
      outline: false,
      content: { type: "doc", content: [{ type: "callout", content: [p("前"), p("/高亮")] }] },
      onChange() {
        if (mode === "destroy") c.destroy();
        if (mode === "unmount") c.editor.unmount();
        if (mode === "remount") {
          c.editor.unmount();
          c.editor.mount(el);
          external.focus();
        }
        if (mode === "focus") external.focus();
      },
    });
    let from = -1;
    c.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "paragraph" && n.textContent === "/高亮") from = pos + 1;
    });
    let output;
    try {
      output = {
        result: insertCalloutSiblingFromSlash(c.editor, { from, to: from + 3 }),
        destroyed: c.editor.isDestroyed,
        externalFocused: document.activeElement === external,
      };
    } catch (e) {
      output = {
        error: String(e),
        destroyed: c.editor.isDestroyed,
        externalFocused: document.activeElement === external,
      };
    }
    if (mode === "unmount") c.editor.mount(el);
    c.destroy();
    el.remove();
    external.remove();
    return output;
  },
});
