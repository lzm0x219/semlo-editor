import "@semlo-editor/core/style.css";
import { createEditor, type EditorController } from "@semlo-editor/core";

declare global {
  interface Window {
    semloCrossBrowser?: { editors: EditorController[]; errors: string[]; changes: number[] };
  }
}

const fixture: NonNullable<Window["semloCrossBrowser"]> = { editors: [], errors: [], changes: [0, 0] };
for (const [index, initial] of ["甲", "乙"].entries()) {
  const element = document.createElement("div");
  element.id = `cross-browser-${index}`;
  document.body.append(element);
  fixture.editors.push(
    createEditor({
      element,
      content: `<p>${initial}</p>`,
      outline: false,
      onChange: () => fixture.changes[index]++,
      onError: (error) => fixture.errors.push(error.message),
    }),
  );
}
window.semloCrossBrowser = fixture;
