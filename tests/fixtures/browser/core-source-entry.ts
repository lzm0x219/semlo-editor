import { createEditor } from "../../../packages/core/src/index";

import "../../../packages/core/src/styles/bundle.css";

declare global {
  interface Window {
    semloSourceCreateEditor: typeof createEditor;
  }
}

window.semloSourceCreateEditor = createEditor;
