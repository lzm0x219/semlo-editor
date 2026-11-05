import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { openCardMenu } from "../../../packages/core/src/features/insertion/menu";

const host = document.createElement("div");
document.body.append(host);
const controller = createEditor({
  element: host,
  outline: false,
  content:
    '<p>外部</p><details open><summary>标题</summary><div data-type="detailsContent"><p>内部</p></div></details>',
});
const editor = controller.editor;
let inside = 0;
editor.state.doc.descendants((node, pos, parent) => {
  if (node.type.name === "paragraph" && parent?.type.name === "detailsContent") inside = pos;
});
const target = editor.state.doc.nodeAt(inside)!;
const anchor = document.createElement("button");
anchor.textContent = "打开目标菜单";
document.body.append(anchor);
const noop = () => {};
let close: (() => void) | undefined;
anchor.addEventListener("click", () => {
  editor.commands.setTextSelection(1);
  close = openCardMenu(editor, noop, noop, noop, noop, noop, anchor, {
    blockBelow: true,
    trigger: anchor,
    getInsertPosition: () => (editor.state.doc.nodeAt(inside) === target ? inside : null),
  });
});
Object.assign(window, {
  targetFixture: {
    replaceTarget() {
      editor.commands.insertContentAt({ from: inside, to: inside + target.nodeSize }, { type: "paragraph" });
    },
    snapshot: () => editor.getJSON(),
    close: () => close?.(),
  },
});
