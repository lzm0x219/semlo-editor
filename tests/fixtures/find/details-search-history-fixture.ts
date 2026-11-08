import { createEditor } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

const host = document.createElement("main");
host.id = "details-search-history";
document.body.append(host);

const controller = createEditor({
  element: host,
  outline: false,
  content:
    '<p>前文</p><details><summary>卡片标题</summary><div data-type="detailsContent"><p>折叠命中文字</p></div></details>',
});

Object.assign(window, { detailsSearchHistoryFixture: controller });
