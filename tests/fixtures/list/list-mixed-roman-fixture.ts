import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

import { mixedRomanContent } from "./list-mixed-roman-content";

type Slot = "primary" | "secondary";
const controllers = new Map<Slot, EditorController>();
const changes = new Map<Slot, number>();
document.body.innerHTML = '<main id="primary"></main><main id="secondary"></main><article id="reader"></article>';
document.body.style.margin = "40px";

function mount(slot: Slot, content: EditorContent, echo: "json" | "html" | null = null, editable = true) {
  controllers.get(slot)?.destroy();
  const host = document.getElementById(slot)!;
  host.replaceChildren();
  changes.set(slot, 0);
  const controller = createEditor({
    element: host,
    content,
    outline: false,
    editable,
    onChange(snapshot) {
      changes.set(slot, (changes.get(slot) ?? 0) + 1);
      if (echo) controllers.get(slot)?.setContent(echo === "html" ? snapshot.html : snapshot.json);
    },
  });
  controllers.set(slot, controller);
}

function get(slot: Slot = "primary") {
  const controller = controllers.get(slot);
  if (!controller) throw new Error(`未挂载${slot}`);
  return controller;
}

function destroy() {
  for (const controller of controllers.values()) controller.destroy();
  controllers.clear();
  for (const id of ["primary", "secondary", "reader"]) document.getElementById(id)!.replaceChildren();
}

const fixture = { mount, get, destroy, changes: (slot: Slot = "primary") => changes.get(slot) ?? 0 };
declare global {
  interface Window {
    mixedRomanFixture: typeof fixture;
  }
}
window.mixedRomanFixture = fixture;
mount("primary", mixedRomanContent());
