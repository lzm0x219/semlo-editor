import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../demo/editor.css";

const host = document.querySelector<HTMLElement>("#root")!;
let uploadCount = 0;
const controller = createEditor({
  element: host,
  content: "<p>正文</p>",
  outline: false,
  uploadImage: async () => {
    uploadCount++;
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII=";
  },
});
Object.assign(window, { canvasEditor: controller });
Object.assign(window, { canvasUploadCount: () => uploadCount });
