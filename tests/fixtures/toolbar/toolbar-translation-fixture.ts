import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { mountTranslationPanel, type TranslationService } from "../../../packages/core/src/ui/toolbar/translation";

import "../../../demo/editor.css";
import "../../../packages/core/src/ui/toolbar/translation.css";

const host = document.createElement("div");
document.body.append(host);
const controller = createEditor({ element: host, content: "<p><strong>甲乙丙丁</strong>戊己庚辛</p><h1>标题</h1>" });
const editor = controller.editor;
const requests: { text: string; signal: AbortSignal; resolve(value: string): void; reject(error: Error): void }[] = [];
const service: TranslationService = ({ text, signal }) =>
  new Promise((resolve, reject) => requests.push({ text, signal, resolve, reject }));
const panel = mountTranslationPanel(editor, host.querySelector(".semlo-editor-editor-body")!, () => service);
const button = document.createElement("button");
button.textContent = "打开翻译";
button.addEventListener("click", () => panel.open(button));
document.body.prepend(button);
Object.assign(window, {
  translationFixture: {
    select: (from: number, to: number) => editor.commands.setTextSelection({ from, to }),
    requests: () => requests.map(({ text, signal }) => ({ text, aborted: signal.aborted })),
    resolve: (index: number, text: string) => requests[index]?.resolve(text),
    reject: (index: number) => requests[index]?.reject(new Error("test failure")),
    snapshot: () => editor.getHTML(),
    replaceDocument: () => editor.commands.setContent("<p>新文本</p>"),
    destroy: () => {
      panel.destroy();
      controller.destroy();
    },
  },
});
