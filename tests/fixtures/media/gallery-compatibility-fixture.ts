import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    galleryCompatibility?: { editor?: EditorController; errors: string[]; mount(data: unknown): void };
  }
}

window.galleryCompatibility = {
  errors: [],
  mount(data) {
    const element = document.createElement("div");
    element.id = "gallery-compatibility";
    document.body.append(element);
    const fixture = window.galleryCompatibility!;
    fixture.editor = createEditor({
      element,
      toolbar: false,
      outline: false,
      content: { type: "doc", content: [{ type: "semloEditorGallery", attrs: { data } }] },
      onError: (error) => fixture.errors.push(error.message),
    });
  },
};
