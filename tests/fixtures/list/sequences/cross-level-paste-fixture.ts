import { createEditor } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

import { crossLevelPasteContent } from "./cross-level-paste-content";

const host = document.createElement("main");
host.id = "cross-level-paste";
document.body.append(host);

createEditor({
  element: host,
  outline: false,
  content: new URLSearchParams(location.search).has("versioned")
    ? crossLevelPasteContent()
    : "<ol><li>父甲<ol><li>子甲</li><li>子乙</li></ol></li><li>父乙</li><li>父丙</li></ol><p>尾段</p>",
});
