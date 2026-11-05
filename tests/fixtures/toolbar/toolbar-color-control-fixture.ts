import { createToolbarColorControl } from "../../../packages/core/src/ui/toolbar/color-control";

import "../../../packages/core/src/ui/toolbar/color-control.css";

declare global {
  interface Window {
    setTextColor?: (color: string | null) => void;
    setBackgroundColor?: (color: string | null) => void;
  }
}

const textHost = document.createElement("div");
textHost.id = "text";
const backgroundHost = document.createElement("div");
backgroundHost.id = "background";
document.body.append(textHost, backgroundHost);
const text = createToolbarColorControl(
  document,
  "text",
  (color) => (document.body.dataset.text = String(color)),
  () => (document.body.dataset.open = "text"),
);
const background = createToolbarColorControl(
  document,
  "background",
  (color) => (document.body.dataset.background = String(color)),
  () => (document.body.dataset.open = "background"),
);
textHost.append(text.element);
backgroundHost.append(background.element);
window.setTextColor = (color) => text.setColor(color);
window.setBackgroundColor = (color) => background.setColor(color);
