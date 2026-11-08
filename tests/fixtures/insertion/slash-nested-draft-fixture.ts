import { createEditor, type EditorControllerWithResults, type EditorSnapshot } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

declare global {
  interface Window {
    nestedSlashEditor?: EditorControllerWithResults;
    nestedSlashChanges?: EditorSnapshot[];
  }
}

const host = document.createElement("div");
host.id = "nested-slash";
document.body.append(host);
window.nestedSlashChanges = [];
const persistence = new URLSearchParams(location.search).has("persistence");
const storageKey = "semlo-highlight-draft-acceptance";
const saved = persistence ? sessionStorage.getItem(storageKey) : null;
const baseline = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "基线" }] },
    { type: "callout", attrs: { tone: "green" }, content: [{ type: "paragraph" }] },
  ],
};
let instance: EditorControllerWithResults;
instance = createEditor({
  element: host,
  outline: false,
  content: persistence ? (saved ? JSON.parse(saved) : baseline) : "<p></p>",
  onChange(snapshot) {
    window.nestedSlashChanges!.push(snapshot);
    if (persistence) sessionStorage.setItem(storageKey, JSON.stringify(snapshot.json));
    instance.setContent(snapshot.json);
  },
});
window.nestedSlashEditor = instance;
if (persistence && !saved) sessionStorage.setItem(storageKey, JSON.stringify(instance.getSnapshot().json));
